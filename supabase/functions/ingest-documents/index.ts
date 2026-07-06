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
                    availability: input.availability || null, source_group: sourceGroup, chunk_index: 0, n_chunks: 1 },
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
      metadata: { ...baseMeta, source_group: sourceGroup, chunk_index: i, n_chunks: windows.length },
    });
  }
  return { rows, sourceGroup };
}

// ---------- crawl bordet.fr ----------
async function crawlBordet(rawUrl: string): Promise<{
  type: IngestType; title: string; url: string; body: string;
  brand?: string; price?: number | null; sku?: string; availability?: string;
}> {
  const url = rawUrl.trim();
  if (!/^https?:\/\/(www\.)?bordet\.fr\//i.test(url)) throw new Error("URL hors bordet.fr");
  const res = await fetch(url, { headers: { "User-Agent": "BordetIngestBot/1.0" } });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  // pages servies en ISO-8859-1 avec octets cp1252 (’ = 0x92) -> windows-1252 remappe correctement
  const html = new TextDecoder("windows-1252").decode(await res.arrayBuffer());
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("parse HTML impossible");

  // PRODUIT : -c2x -> JSON schema.org dans <script id="productData">
  if (/-c2x\d/i.test(url)) {
    const raw = doc.querySelector("#productData")?.textContent?.trim();
    if (!raw) throw new Error("productData introuvable (page produit ?)");
    const pd = JSON.parse(raw);
    const offer = Array.isArray(pd.offers) ? pd.offers[0] : pd.offers;
    let desc = (pd.description || "").toString().trim();
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
    const body = (bodyEl?.textContent || "").replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();
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

  // ---- LIST : sources ajoutées via l'UI (groupées, sans embedding ni content) ----
  if (action === "list") {
    const { data, error } = await sb.from("documents")
      .select("source_uid, metadata")
      .eq("bot_id", BOT_ID)
      .eq("metadata->>added_via", "admin-ui")
      .limit(5000);
    if (error) return json({ error: error.message }, 500);
    type Meta = { source_group?: string; title?: string; source_type?: string; url?: string; added_at?: string; added_by?: string };
    type Group = { source_group: string; title?: string; source_type?: string; url?: string; added_at?: string; added_by?: string; n_chunks: number };
    const groups = new Map<string, Group>();
    for (const r of (data ?? []) as Array<{ source_uid: string; metadata: Meta }>) {
      const m: Meta = r.metadata || {};
      const g = m.source_group || r.source_uid;
      const cur = groups.get(g) || { source_group: g, title: m.title, source_type: m.source_type,
                                     url: m.url, added_at: m.added_at, added_by: m.added_by, n_chunks: 0 };
      cur.n_chunks += 1;
      groups.set(g, cur);
    }
    const sources = [...groups.values()].sort((a, b) => String(b.added_at).localeCompare(String(a.added_at)));
    return json({ ok: true, sources });
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

    let rows: Row[], sourceGroup: string;
    try {
      ({ rows, sourceGroup } = await buildRows({ ...src, addedBy: email }));
    } catch (e) { return json({ error: `chunking: ${e instanceof Error ? e.message : e}` }, 400); }

    if (!rows.length) return json({ error: "aucun chunk produit" }, 400);
    if (rows.length > MAX_CHUNKS) return json({ error: `${rows.length} chunks > max ${MAX_CHUNKS} — scinder la source` }, 413);
    for (const r of rows) if (estTokens(r.content) > MISTRAL_MAX_TOKENS) return json({ error: "un chunk dépasse la limite d'embedding" }, 400);

    // 1) embeddings
    let vectors: number[][];
    try { vectors = await embedAll(rows.map((r) => r.content), mistralKey); }
    catch (e) { return json({ error: `embeddings: ${e instanceof Error ? e.message : e}` }, 502); }

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
