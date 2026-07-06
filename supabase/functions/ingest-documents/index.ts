// Edge Function: ingest-documents
// ---------------------------------------------------------------------------
// Ajout / gestion de contenu dans la base vecto `documents` depuis le back-office admin.
//
// Pourquoi une Edge Function (et pas un accès direct depuis le navigateur) :
//   - INSERT/UPDATE/DELETE sur `documents` = réservés à `service_role` (RLS ferme le reste).
//   - L'embedding nécessite la clé Mistral, qui ne doit JAMAIS quitter le serveur.
//   Les DEUX secrets restent donc ici. Le navigateur n'envoie que du contenu brut + son JWT admin.
//
// Auth : verify_jwt (gateway Supabase) valide la signature du token, PUIS on vérifie
//        `user_profiles.is_admin` via service_role. Aucun secret partagé à distribuer.
//        Déploiement : `supabase functions deploy ingest-documents`  (verify_jwt ON par défaut).
//
// Actions (POST { action, ... }) :
//   - upsert : { type, title, url?, body, brand?, price?, sku?, availability? }
//              -> chunk + injecte l'URL dans le content + embed + remplace la source (idempotent).
//   - crawl  : { url }  -> récupère une page bordet.fr (produit -c2x / blog -c1200x), extrait, puis upsert.
//   - list   : { }      -> liste les sources ajoutées via l'UI (groupées, sans embedding).
//   - delete : { source_group } -> supprime tous les chunks d'une source.
//
// Contrat de lecture respecté : le corps va dans la colonne `content`, l'URL est répétée
// DANS le content (« Lien : … » / « Source : … ») pour survivre à sanitizeUrls et rester citable,
// `metadata.title`/`metadata.url` servent au linking, `metadata.source_type` pilote le libellé
// et le gating livres (source_type='book' = visible marketing/admin seulement).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { DOMParser } from "jsr:@b-fuze/deno-dom@0.1.56";

const MISTRAL_API_BASE = "https://api.mistral.ai/v1";
const EMBED_MODEL = "mistral-embed";
const BOT_ID = "bot1";
const DIM = 1024;

// --- nettoyage IA du texte extrait (PDF) : formatage SEULEMENT, jamais de réécriture du fond ---
const CLEAN_MODEL = "mistral-medium-latest";
const CLEAN_TARGET_TOK = 3000;        // taille d'un segment envoyé au modèle (un PDF dépasse le contexte)
const CLEAN_MAX_TOKENS = 4096;        // sortie par segment (~ taille de l'entrée nettoyée)
const MAX_CLEAN_CHARS = 150_000;      // garde-fou coût/latence (~10-12 appels medium) ; au-delà -> découper
const CLEAN_SYSTEM =
`Tu nettoies du texte BRUT extrait d'un PDF (souvent une page web sauvegardée), destiné à une base de connaissances.
Objectif : ne garder que le CONTENU utile, SANS en altérer le fond.

À SUPPRIMER (habillage, ce n'est PAS du contenu) :
- Césures : recolle les mots coupés en fin de ligne (« exem- ple » -> « exemple »).
- Pagination : en-têtes, pieds de page, numéros de page isolés, « Page X/Y ».
- Habillage de site web quand il apparaît : menu/barre de navigation, fil d'Ariane (« Accueil > … »), liste des catégories ou rubriques du site, bandeau cookies, coordonnées/numéro de téléphone/adresse répétés en en-tête ou pied, slogans d'entreprise (« … depuis 60 ans »), boutons (« Ajouter au panier », « Voir aussi », « Partager »), liens réseaux sociaux, formulaire newsletter, mentions légales répétées.

À CONSERVER (le contenu) :
- Le titre et le corps du document, les paragraphes, les VRAIES listes du contenu, les tableaux, et l'ORDRE.
- Reconstitue les paragraphes (fusionne les retours à la ligne parasites au milieu d'une phrase).

RÈGLES ABSOLUES :
- Ne modifie AUCUN mot, chiffre, prix, dimension, référence, marque ou nom propre DU CONTENU.
- N'ajoute rien, ne résume pas, ne reformule pas, ne traduis pas, ne commente pas.
- En cas de DOUTE, GARDE le passage : ne retire que ce qui est clairement de l'habillage de site (répété, hors-sujet), JAMAIS du contenu de fond.
Réponds UNIQUEMENT avec le texte nettoyé, sans introduction, sans balise, sans guillemets englobants.`;

// --- gardes d'ingestion (anti-doublon / qualité / cohérence catalogue) ---
const MIN_BODY_CHARS = 40;    // en dessous : probablement un collage accidentel -> AVERTISSEMENT (pas un blocage)
const SIM_BLOCK = 0.97;       // similarité cosine ≥ 0.97 = quasi-doublon -> refus
const SIM_WARN = 0.90;        // 0.90-0.97 = suspect -> confirmation admin requise

// bornes anti-abus (fonction admin, mais on borne quand même)
const MAX_BODY_BYTES = 2 * 1024 * 1024;   // 2 Mo (un gros PDF -> texte tient largement)
const MAX_CHARS = 400_000;                // ~ garde-fou taille du corps
const MAX_CHUNKS = 400;                    // par source ; au-delà -> refus (scinder)
const EMBED_BATCH = 32;                     // chunks par appel embeddings

// chunking (repris de ingest/build_documents.py : fenêtres tokens estimés)
const WIN_HI = 800, WIN_LO = 500, WIN_OVERLAP = 80;
const MISTRAL_MAX_TOKENS = 8192;

const ALLOWED_ORIGINS = new Set([
  "https://chatbordet.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function corsFor(origin: string | null) {
  const allow = !!origin && ALLOWED_ORIGINS.has(origin);
  return {
    "Access-Control-Allow-Origin": allow ? (origin as string) : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    "Vary": "Origin",
  };
}

// ---------- helpers texte / chunking ----------
function estTokens(s: string): number {
  // proxy FR conservateur (~3.5 char/token), identique à build_documents.py
  return Math.max(1, Math.ceil(s.length / 4) + Math.floor(s.length / 14));
}

async function sha1Hex(s: string, n = 12): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, n);
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note";
}

function cleanMarkdownish(s: string): string {
  if (!s) return "";
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")          // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")        // liens [txt](url) -> txt
    .replace(/(^|\n)\s{0,3}#{1,6}\s*/g, "$1")       // titres markdown
    .replace(/\*\*|__/g, "")                          // gras
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Découpe un texte en fenêtres de 500-800 tokens estimés, avec léger chevauchement.
function chunkText(body: string): string[] {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const windows: string[] = [];
  let cur: string[] = [];
  let curTok = 0;
  const flush = () => {
    if (!cur.length) return;
    windows.push(cur.join("\n\n"));
    const tail = cur[cur.length - 1];
    if (estTokens(tail) <= WIN_OVERLAP && cur.length > 1) { cur = [tail]; curTok = estTokens(tail); }
    else { cur = []; curTok = 0; }
  };
  const hardSplit = (para: string): string[] => {
    const sents = para.split(/(?<=[.!?])\s+/);
    const out: string[] = [];
    let c = "";
    for (const s of sents) {
      if (estTokens(c + " " + s) > WIN_HI && c) { out.push(c.trim()); c = s; }
      else c = (c + " " + s).trim();
    }
    if (c) out.push(c.trim());
    return out;
  };
  for (const para of paras) {
    const pt = estTokens(para);
    if (pt > WIN_HI) { if (cur.length) { windows.push(cur.join("\n\n")); cur = []; curTok = 0; } windows.push(...hardSplit(para)); continue; }
    if (curTok + pt > WIN_HI && curTok >= WIN_LO) flush();
    cur.push(para); curTok += pt;
  }
  if (cur.length) windows.push(cur.join("\n\n"));
  if (windows.length > 1 && estTokens(windows[windows.length - 1]) < 150) {
    windows[windows.length - 2] += "\n\n" + windows[windows.length - 1];
    windows.pop();
  }
  return windows.length ? windows : [body.trim()].filter(Boolean);
}

// Regroupe le texte en segments ~CLEAN_TARGET_TOK pour le nettoyage LLM (contexte borné).
function segmentForClean(text: string): string[] {
  const paras = text.split(/\n\s*\n/);
  const segs: string[] = [];
  let cur: string[] = [], curTok = 0;
  for (const p of paras) {
    const pt = estTokens(p);
    if (pt > CLEAN_TARGET_TOK) {                       // paragraphe géant -> coupe par phrases
      if (cur.length) { segs.push(cur.join("\n\n")); cur = []; curTok = 0; }
      let c = "", ct = 0;
      for (const s of p.split(/(?<=[.!?])\s+/)) {
        const st = estTokens(s);
        if (ct + st > CLEAN_TARGET_TOK && c) { segs.push(c); c = s; ct = st; }
        else { c = (c ? c + " " : "") + s; ct += st; }
      }
      if (c) segs.push(c);
      continue;
    }
    if (curTok + pt > CLEAN_TARGET_TOK && cur.length) { segs.push(cur.join("\n\n")); cur = []; curTok = 0; }
    cur.push(p); curTok += pt;
  }
  if (cur.length) segs.push(cur.join("\n\n"));
  return segs.length ? segs : [text];
}

// normalisation pour le hash de dédup exacte : insensible à la casse, aux espaces et aux URLs
const normForHash = (s: string) =>
  s.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();

// ---------- types ----------
type IngestType = "product" | "article" | "book" | "manual";
type Row = { source_uid: string; content: string; metadata: Record<string, unknown> };

// Fabrique les lignes (chunks) prêtes à embedder pour une source.
async function buildRows(input: {
  type: IngestType; title: string; url?: string; body: string;
  brand?: string; price?: number | null; sku?: string; availability?: string;
  addedBy: string; source?: string;
}): Promise<{ rows: Row[]; sourceGroup: string }> {
  const { type, title, url, addedBy } = input;
  const body = cleanMarkdownish(input.body);
  const now = new Date().toISOString();
  const baseMeta = {
    source_type: type,
    title,
    url: url || null,
    added_via: "admin-ui",
    added_by: addedBy,
    added_at: now,
    source: input.source || "admin-ui",
    model: EMBED_MODEL,
  };

  // --- PRODUIT : 1 fiche = 1 chunk, en-tête + desc + prix + lien ---
  if (type === "product") {
    if (!url) throw new Error("un produit doit avoir une URL");
    let content = title + (input.brand ? ` (${input.brand})` : "");
    if (body) content += ` : ${body}`;
    if (typeof input.price === "number" && !Number.isNaN(input.price)) {
      content += `\nPrix : ${input.price.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € TTC`;
    }
    if (input.availability) content += ` — Disponibilité : ${input.availability}`;
    content += `\nLien : ${url}`;
    const sourceGroup = `product:${url}`;
    return {
      sourceGroup,
      rows: [{
        source_uid: sourceGroup,
        content,
        metadata: { ...baseMeta, brand: input.brand || null, sku: input.sku || null, price: input.price ?? null,
                    availability: input.availability || null, source_group: sourceGroup, chunk_index: 0, n_chunks: 1,
                    content_hash: await sha1Hex(normForHash(content), 16), raw_body: body },
      }],
    };
  }

  // --- ARTICLE / MANUAL / BOOK : chunké en fenêtres ---
  const windows = chunkText(body);
  if (!windows.length) throw new Error("corps vide après nettoyage");
  const groupSeed = url || `${type}:${title}`;
  const sourceGroup = url ? (type === "article" ? `blog:${await sha1Hex(url)}` : `manual:${await sha1Hex(url)}`)
                          : `${type === "book" ? "book" : "manual"}:${slugify(title)}-${await sha1Hex(groupSeed, 8)}`;
  const rows: Row[] = [];
  for (let i = 0; i < windows.length; i++) {
    let content: string;
    if (type === "book") {
      content = `Extrait du document « ${title} » : ${windows[i]}`;
    } else {
      content = `${title}\n\n${windows[i]}`.trim();
    }
    if (url) content += `\nSource : ${url}`;
    rows.push({
      source_uid: `${sourceGroup}#${String(i).padStart(4, "0")}`,
      content,
      // hash de dédup calculé sur la FENÊTRE brute (sans titre ni "Source :") :
      // le même corps collé sous un autre titre reste détecté comme doublon EXACT (garde A).
      // raw_body (texte source complet) stocké UNE fois, sur le 1er chunk, pour l'édition/relecture.
      metadata: { ...baseMeta, source_group: sourceGroup, chunk_index: i, n_chunks: windows.length,
                  content_hash: await sha1Hex(normForHash(windows[i]), 16), ...(i === 0 ? { raw_body: body } : {}) },
    });
  }
  return { rows, sourceGroup };
}

// ---------- crawl bordet.fr ----------
// Convertit un fragment HTML (description produit Oxatis, corps d'article) en texte lisible :
// décode les entités (&eacute; -> é), transforme <br>/<li>/<p> en sauts de ligne / puces, retire les balises.
function htmlToText(html: string): string {
  if (!html) return "";
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\/\s*(p|div|h[1-6]|li|tr|ul|ol)\s*>/gi, "\n");
  const d = new DOMParser().parseFromString(withBreaks, "text/html");
  const t = d?.body?.textContent ?? d?.textContent ?? "";
  return t.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function crawlBordet(rawUrl: string): Promise<{
  type: IngestType; title: string; url: string; body: string;
  brand?: string; price?: number | null; sku?: string; availability?: string;
}> {
  const url = rawUrl.trim();
  if (!/^https?:\/\/(www\.)?bordet\.fr\//i.test(url)) throw new Error("URL hors bordet.fr");
  // bordet.fr (Oxatis) bloque en 403 les IP datacenter — dont l'edge Supabase (vérifié). On passe donc
  // par le lecteur Jina (non bloqué) en mode HTML : il renvoie la page COMPLÈTE, y compris
  // <script id="productData">, donc l'extraction structurée ci-dessous reste identique.
  const jinaKey = Deno.env.get("JINA_API_KEY");   // optionnel : quotas plus élevés si défini
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      "X-Return-Format": "html",
      "Accept": "text/html",
      ...(jinaKey ? { Authorization: `Bearer ${jinaKey}` } : {}),
    },
  });
  if (res.status === 429) throw new Error("service de lecture temporairement saturé (429) — réessayez dans un instant");
  if (!res.ok) throw new Error(`lecture de la page impossible (${res.status})`);
  const html = await res.text();   // Jina renvoie de l'UTF-8 propre (plus besoin du remap cp1252)
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("parse HTML impossible");

  // PRODUIT : -c2x -> JSON schema.org dans <script id="productData">
  if (/-c2x\d/i.test(url)) {
    const raw = doc.querySelector("#productData")?.textContent?.trim();
    if (!raw) throw new Error("productData introuvable (page produit ?)");
    const pd = JSON.parse(raw);
    const offer = Array.isArray(pd.offers) ? pd.offers[0] : pd.offers;
    let desc = htmlToText((pd.description || "").toString());   // description = HTML Oxatis -> texte propre
    desc = desc.replace(/^Tout savoir sur l'article\s+.*?(?:\n|$)/i, "").trim();
    return {
      type: "product", url, title: (pd.name || "").toString().trim(),
      body: desc, brand: (pd.brand?.name || pd.brand || "").toString().trim() || undefined,
      sku: (pd.sku || "").toString().trim() || undefined,
      price: offer?.price ? Number(offer.price) : null,
      availability: (offer?.availability || "").toString().replace(/^https?:\/\/schema\.org\//, "") || undefined,
    };
  }

  // BLOG : -c1200x -> corps dans .PBItemDesc1, titre h1.articletitle
  if (/-c1200x\d/i.test(url)) {
    const title = doc.querySelector("h1.articletitle")?.textContent?.trim()
      || doc.querySelector("h1")?.textContent?.trim() || url;
    const bodyEl = doc.querySelector(".PBItemDesc1");
    const body = htmlToText(bodyEl?.innerHTML || "").replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (!body) throw new Error("corps d'article introuvable (.PBItemDesc1)");
    return { type: "article", url, title, body };
  }

  throw new Error("URL non reconnue (attendu -c2x<id> produit ou -c1200x<id> blog)");
}

// ---------- embeddings ----------
async function embedAll(texts: string[], mistralKey: string): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const r = await fetch(`${MISTRAL_API_BASE}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${mistralKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: batch }),
    });
    if (!r.ok) throw new Error(`mistral embeddings ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
    const data = await r.json();
    const vs: number[][] = (data.data ?? []).map((d: { embedding: number[] }) => d.embedding);
    if (vs.length !== batch.length) throw new Error(`embed mismatch ${vs.length}/${batch.length}`);
    for (const v of vs) if (v.length !== DIM) throw new Error(`dim ${v.length} != ${DIM}`);
    vectors.push(...vs);
  }
  return vectors;
}

// ---------- serveur ----------
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = corsFor(origin);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "origin not allowed" }, 403);
  if (Number(req.headers.get("Content-Length") || "0") > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);

  const mistralKey = Deno.env.get("MISTRAL_API_KEY");
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!mistralKey || !supaUrl || !serviceKey) return json({ error: "server not configured" }, 500);

  const sb = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

  // --- garde admin : on VALIDE le token via GoTrue (getUser) puis on vérifie is_admin.
  // Indépendant du flag verify_jwt du déploiement : la signature/validité est vérifiée ici,
  // donc pas de JWT forgé possible, et le préflight CORS (OPTIONS sans token) reste libre. ---
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);
  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return json({ error: "unauthorized" }, 401);   // anon key / token invalide -> rejeté
  const { data: profile } = await sb.from("user_profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return json({ error: "admin only" }, 403);
  const email = user.email ?? user.id;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const action = body?.action;

  // ---- CLEAN : nettoyage IA du texte extrait (formatage seulement, jamais de réécriture) ----
  if (action === "clean") {
    const text = String(body?.text || "");
    if (!text.trim()) return json({ error: "texte vide" }, 400);
    if (text.length > MAX_CLEAN_CHARS)
      return json({ error: `texte trop long pour le nettoyage auto (> ${MAX_CLEAN_CHARS} caractères) — découpe le document` }, 413);
    const segments = segmentForClean(text);
    const out: string[] = [];
    for (const seg of segments) {
      const r = await fetch(`${MISTRAL_API_BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${mistralKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: CLEAN_MODEL, temperature: 0, max_tokens: CLEAN_MAX_TOKENS,
          messages: [{ role: "system", content: CLEAN_SYSTEM }, { role: "user", content: seg }],
        }),
      });
      if (!r.ok) return json({ error: `nettoyage: mistral ${r.status}` }, 502);
      const d = await r.json();
      const c = d?.choices?.[0]?.message?.content;
      out.push(typeof c === "string" && c.trim() ? c.trim() : seg);   // fallback : segment brut si réponse vide
    }
    return json({ ok: true, cleaned: out.join("\n\n"), segments: segments.length });
  }

  // ---- LIST : sources ajoutées via l'UI (groupées ; champs ciblés -> ne tire PAS raw_body/content) ----
  if (action === "list") {
    const { data, error } = await sb.from("documents")
      .select("source_uid, sg:metadata->>source_group, ti:metadata->>title, st:metadata->>source_type, u:metadata->>url, aa:metadata->>added_at, ab:metadata->>added_by")
      .eq("bot_id", BOT_ID)
      .eq("metadata->>added_via", "admin-ui")
      .limit(5000);
    if (error) return json({ error: error.message }, 500);
    type Flat = { source_uid: string; sg: string | null; ti: string | null; st: string | null; u: string | null; aa: string | null; ab: string | null };
    type Group = { source_group: string; title?: string; source_type?: string; url?: string; added_at?: string; added_by?: string; n_chunks: number };
    const groups = new Map<string, Group>();
    for (const r of (data ?? []) as Flat[]) {
      const g = r.sg || r.source_uid;
      const cur = groups.get(g) || { source_group: g, title: r.ti ?? undefined, source_type: r.st ?? undefined,
                                     url: r.u ?? undefined, added_at: r.aa ?? undefined, added_by: r.ab ?? undefined, n_chunks: 0 };
      cur.n_chunks += 1;
      groups.set(g, cur);
    }
    const sources = [...groups.values()].sort((a, b) => String(b.added_at).localeCompare(String(a.added_at)));
    return json({ ok: true, sources });
  }

  // ---- GET : texte source d'une source (pour relire / éditer depuis « Gérer ») ----
  if (action === "get") {
    const g = body?.source_group;
    if (!g || typeof g !== "string") return json({ error: "source_group requis" }, 400);
    const { data, error } = await sb.from("documents")
      .select("content, metadata")
      .eq("bot_id", BOT_ID).eq("metadata->>source_group", g)
      .order("source_uid").limit(MAX_CHUNKS);
    if (error) return json({ error: error.message }, 500);
    if (!data || !data.length) return json({ error: "source introuvable" }, 404);
    const m0 = (data[0].metadata || {}) as Record<string, unknown>;
    // corps éditable : raw_body si présent ; sinon reconstruction best-effort en retirant les habillages
    let bodyText = typeof m0.raw_body === "string" ? m0.raw_body : "";
    if (!bodyText) {
      const stype = m0.source_type, title = String(m0.title ?? ""), u = m0.url ? String(m0.url) : "";
      const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      bodyText = (data as Array<{ content: string }>).map((r) => {
        let c = String(r.content ?? "");
        if (stype === "book") c = c.replace(/^Extrait du document « .* » : /, "");
        else if (title) c = c.replace(new RegExp("^" + esc + "\\n\\n"), "");
        if (u) c = c.replace("\nSource : " + u, "").replace("\nLien : " + u, "");
        return c.trim();
      }).join("\n\n");
    }
    return json({ ok: true, source_group: g, title: m0.title ?? "", type: m0.source_type ?? "manual",
                  url: m0.url ?? null, brand: m0.brand ?? null, sku: m0.sku ?? null,
                  price: m0.price ?? null, availability: m0.availability ?? null, body: bodyText });
  }

  // ---- DELETE : supprime tous les chunks d'une source ----
  if (action === "delete") {
    const g = body?.source_group;
    if (!g || typeof g !== "string") return json({ error: "source_group requis" }, 400);
    const { data, error } = await sb.from("documents").delete()
      .eq("bot_id", BOT_ID).eq("metadata->>source_group", g).select("id");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, deleted: (data ?? []).length });
  }

  // ---- UPSERT / CRAWL : produisent une source puis embeddent + remplacent ----
  if (action === "upsert" || action === "crawl") {
    let src: {
      type: IngestType; title: string; url?: string; body: string;
      brand?: string; price?: number | null; sku?: string; availability?: string; source?: string;
    };
    try {
      if (action === "crawl") {
        src = { ...(await crawlBordet(String(body?.url || ""))), source: "crawl" };
      } else {
        const type = body?.type as IngestType;
        if (!["product", "article", "book", "manual"].includes(type)) return json({ error: "type invalide" }, 400);
        const title = String(body?.title || "").trim();
        const content = String(body?.body || "").trim();
        if (!title) return json({ error: "titre requis" }, 400);
        if (!content && type !== "product") return json({ error: "corps requis" }, 400);
        if (content.length > MAX_CHARS) return json({ error: `corps trop long (> ${MAX_CHARS} caractères)` }, 413);
        src = {
          type, title, body: content,
          url: body?.url ? String(body.url).trim() : undefined,
          brand: body?.brand ? String(body.brand).trim() : undefined,
          sku: body?.sku ? String(body.sku).trim() : undefined,
          price: typeof body?.price === "number" ? body.price : (body?.price ? Number(body.price) : null),
          availability: body?.availability ? String(body.availability).trim() : undefined,
          source: "paste",
        };
      }
    } catch (e) { return json({ error: `préparation: ${e instanceof Error ? e.message : e}` }, 400); }

    // APERÇU (crawl) : renvoie le contenu extrait SANS écrire — l'UI le fait relire/valider avant l'ingestion.
    if (action === "crawl" && body?.preview === true) {
      return json({ ok: true, preview: true, type: src.type, title: src.title, url: src.url ?? null,
                    body: src.body, brand: src.brand ?? null, price: src.price ?? null,
                    sku: src.sku ?? null, availability: src.availability ?? null });
    }

    let rows: Row[], sourceGroup: string;
    try {
      ({ rows, sourceGroup } = await buildRows({ ...src, addedBy: email }));
    } catch (e) { return json({ error: `chunking: ${e instanceof Error ? e.message : e}` }, 400); }

    if (!rows.length) return json({ error: "aucun chunk produit" }, 400);
    if (rows.length > MAX_CHUNKS) return json({ error: `${rows.length} chunks > max ${MAX_CHUNKS} — scinder la source` }, 413);
    for (const r of rows) if (estTokens(r.content) > MISTRAL_MAX_TOKENS) return json({ error: "un chunk dépasse la limite d'embedding" }, 400);

    // ===================== GARDES D'INGESTION =====================
    // Principe : bloquer les données qui casseraient le RAG À L'ENTRÉE (doublons,
    // bruit, contradictions), plutôt que de rattraper à la sortie.
    // block -> 400 (refus net) ; warn -> 409 {warnings} et l'UI redemande avec force:true.
    const force = body?.force === true;
    const warnings: string[] = [];

    // --- GARDE C : qualité du texte (types chunkés ; une fiche produit courte est légitime) ---
    if (src.type !== "product") {
      // texte très court : on n'empêche plus (note délibérée légitime) -> simple avertissement
      if (src.body.trim().length < MIN_BODY_CHARS)
        warnings.push(`contenu très court (${src.body.trim().length} caractères) — peu de matière pour le RAG`);
      const moji = (src.body.match(/Ã.|â€.|�/g) || []).length;
      if (moji >= 5)
        return json({ error: `encodage cassé détecté (${moji} artefacts type « Ã© / â€™ ») — recollez le texte depuis la source` }, 400);
      // ligne répétée = artefact de copier-coller (menu de navigation, en-tête de page…)
      const counts = new Map<string, number>();
      for (const ln of src.body.split("\n")) { const t = ln.trim(); if (t.length > 3) counts.set(t, (counts.get(t) || 0) + 1); }
      const rep = [...counts.entries()].find(([, n]) => n > 5);
      if (rep) warnings.push(`la ligne « ${rep[0].slice(0, 60)} » se répète ${rep[1]} fois (artefact de copier-coller ?)`);
      // --- GARDE D2 : prix hors fiche produit = future contradiction avec le catalogue ---
      if (/\d[\d\s .,]*\s*(?:€|euros?\b|EUR\b)/i.test(src.body))
        warnings.push("prix détecté dans un contenu non-produit — les prix doivent vivre dans les fiches produit (contradiction assurée au prochain changement de prix)");
    }

    // --- GARDE A : doublon EXACT parmi les contenus déjà ajoutés via l'UI ---
    // (content_hash calculé dans buildRows sur la fenêtre brute, hors titre/Source)
    // (l'historique crawlé n'a pas de content_hash : lui est couvert par la garde B vectorielle)
    {
      const hashes = rows.slice(0, 100).map((r) => String(r.metadata.content_hash));
      const { data: dup } = await sb.from("documents").select("metadata").eq("bot_id", BOT_ID)
        .in("metadata->>content_hash", hashes).neq("metadata->>source_group", sourceGroup).limit(1);
      if (dup && dup.length) {
        const t = (dup[0].metadata as { title?: string })?.title || "une autre source";
        return json({ error: `contenu identique déjà présent dans « ${t} » — supprimez-le d'abord ou modifiez le texte` }, 400);
      }
    }

    // --- GARDE D1 : lien mort (upsert seulement : un crawl vient de charger la page avec succès) ---
    if (action === "upsert" && src.url) {
      try {
        let hr = await fetch(src.url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000) });
        if (hr.status === 405) { hr = await fetch(src.url, { redirect: "follow", signal: AbortSignal.timeout(5000) }); hr.body?.cancel(); }
        if (hr.status === 404 || hr.status === 410)
          warnings.push(`l'URL répond ${hr.status} (lien mort) — elle serait pourtant citée aux clients`);
      } catch { /* réseau/timeout : on n'empêche pas l'ingestion pour ça */ }
    }

    // avertissements détectés AVANT embedding : on s'arrête ici sans payer l'API
    if (warnings.length && !force) return json({ warnings, need_confirm: true }, 409);

    // 1) embeddings
    let vectors: number[][];
    try { vectors = await embedAll(rows.map((r) => r.content), mistralKey); }
    catch (e) { return json({ error: `embeddings: ${e instanceof Error ? e.message : e}` }, 502); }

    // --- GARDE B : quasi-doublon SÉMANTIQUE (l'embedding est déjà calculé -> coût = 1-3 RPC) ---
    // Sondes : 1er, milieu, dernier chunk. include_books:true = on compare aussi aux livres.
    {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
      const rpc = (fn: string, payload: unknown) =>
        fetch(`${supaUrl}/rest/v1/rpc/${fn}`, {
          method: "POST",
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      type Near = { similarity: number; metadata?: { source_group?: string; source_uid?: string; title?: string } };
      const probes = [...new Set([0, Math.floor(rows.length / 2), rows.length - 1])];
      let worst: { sim: number; title: string } | null = null;
      for (const i of probes) {
        const qe = `[${vectors[i].join(",")}]`;
        let ms: Near[] = [];
        try {
          const r = await rpc("match_documents_hybrid", { query_embedding: qe, query_text: "", match_count: 3, filter_bot_id: BOT_ID, include_books: true });
          if (r.ok) ms = await r.json();
        } catch { /* fallback ci-dessous */ }
        if (!ms.length) {
          try { const r2 = await rpc("match_documents", { query_embedding: qe, match_count: 3, filter_bot_id: BOT_ID }); if (r2.ok) ms = await r2.json(); } catch { ms = []; }
        }
        for (const m of ms) {
          if (m.metadata?.source_group === sourceGroup) continue;                       // ré-ingestion de la même source = légitime
          const mu = m.metadata?.source_uid;
          if (mu && rows.some((r) => r.source_uid === mu)) continue;                    // même clé (ex. re-crawl produit) = remplacement
          if (typeof m.similarity === "number" && (!worst || m.similarity > worst.sim))
            worst = { sim: m.similarity, title: m.metadata?.title || "sans titre" };
        }
      }
      if (worst && worst.sim >= SIM_BLOCK)
        return json({ error: `quasi-doublon de « ${worst.title} » (similarité ${(worst.sim * 100).toFixed(0)} %) — déjà dans la base` }, 400);
      if (worst && worst.sim >= SIM_WARN && !force)
        return json({ warnings: [`très proche de « ${worst.title} » (similarité ${(worst.sim * 100).toFixed(0)} %) — doublon possible`], need_confirm: true }, 409);
    }

    // 2) remplacement idempotent :
    //    a) on efface les chunks PRÉCÉDENTS de cette source (par source_group) -> gère le cas où le
    //       nombre de chunks a diminué (orphelins d'un ré-ajout admin).
    //    b) upsert on_conflict(bot_id, source_uid) -> écrase proprement, et évite la collision avec
    //       une éventuelle ligne du corpus HISTORIQUE au même source_uid (ex. re-crawl d'un blog déjà ingéré).
    const { error: delErr } = await sb.from("documents").delete().eq("bot_id", BOT_ID).eq("metadata->>source_group", sourceGroup);
    if (delErr) return json({ error: `delete: ${delErr.message}` }, 500);

    const toInsert = rows.map((r, i) => ({
      bot_id: BOT_ID, source_uid: r.source_uid, content: r.content, metadata: r.metadata,
      embedding: `[${vectors[i].join(",")}]`,
    }));
    const { error: insErr } = await sb.from("documents").upsert(toInsert, { onConflict: "bot_id,source_uid" });
    if (insErr) return json({ error: `insert: ${insErr.message}` }, 500);

    return json({ ok: true, source_group: sourceGroup, chunks: toInsert.length,
                  title: src.title, type: src.type, url: src.url ?? null });
  }

  return json({ error: "action inconnue (upsert|crawl|list|delete)" }, 400);
});
