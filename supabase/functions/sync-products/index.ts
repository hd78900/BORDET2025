// Edge Function `sync-products` — synchronisation HEBDOMADAIRE du catalogue depuis le feed Doofinder.
//
// Remplace le lancement manuel de `scripts/ingest_products_feed.py` : même pipeline (télécharger le CSV
// cp1252 -> nettoyer -> construire content+metadata -> embedder -> upsert idempotent par source_uid),
// mais côté serveur et déclenché par pg_cron une fois par semaine.
//
// ÉCONOMIE : on ne ré-embedde PAS tout le catalogue chaque semaine. On compare l'empreinte SHA-256 du
// `content` reconstruit avec celle du `content` déjà en base (RPC `product_feed_fingerprints`) et on ne
// traite que les fiches NOUVELLES ou MODIFIÉES (prix, dispo, description). Une semaine calme = quelques
// dizaines d'embeddings au lieu de 5 500.
//
// RESSOURCE BORNÉE : une invocation traite au plus MAX_PER_RUN fiches puis, s'il reste du travail,
// se relance elle-même (chaînage borné à MAX_CHAIN). Comme le diff est recalculé à chaque invocation,
// le processus est sans état et se reprend tout seul en cas d'échec au milieu.
//
// SÉCURITÉ : appelable seulement avec le secret `CRON_SECRET` (en-tête x-cron-secret) ou la clé
// service_role. Aucune clé LLM ni service_role ne sort du serveur.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const FEED_URL = "https://www.bordet.fr/Data/doofinder-all/fr/Oxatis-fr-bordet-38902.csv";
const BOT_ID = "bot1";
const MISTRAL_API_BASE = "https://api.mistral.ai/v1";
const EMBED_MODEL = "mistral-embed";
const DIM = 1024;
const EMBED_BATCH = 32;      // fiches par appel /embeddings (aligné sur ingest-documents)
const UPSERT_BATCH = 100;    // fiches par upsert Postgres
const MAX_PER_RUN = 480;     // fiches embeddées par invocation (garde-fou temps d'exécution)
const MAX_CHAIN = 20;        // relances max -> couvre ~9 600 fiches sur un premier passage complet
// Filet de sécurité : si le feed revient anormalement petit (panne Oxatis, CSV tronqué), on
// NE PURGE PAS le catalogue — sinon un feed vide effacerait toutes les fiches produits.
const MIN_ROWS_FOR_PRUNE = 3000;

const AVAIL: Record<string, string> = {
  "in stock": "En stock",
  "out of stock": "En rupture",
  "preorder": "En précommande",
};

// ---------- utilitaires texte (port fidèle du script Python : les empreintes doivent coïncider) ----------

const normWs = (s: string) => (s || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", eacute: "é", egrave: "è",
  ecirc: "ê", euml: "ë", agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ouml: "ö", ugrave: "ù",
  ucirc: "û", uuml: "ü", icirc: "î", iuml: "ï", oelig: "œ", aelig: "æ", euro: "€", deg: "°",
  times: "×", hellip: "…", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  ndash: "–", mdash: "—", middot: "·", bull: "•", trade: "™", reg: "®", copy: "©", sup2: "²", sup3: "³",
  frac12: "½", frac14: "¼", plusmn: "±", micro: "µ", szlig: "ß", ntilde: "ñ", Eacute: "É", Egrave: "È",
  Agrave: "À", Ccedil: "Ç", Ocirc: "Ô", Ucirc: "Û", Icirc: "Î",
};

function htmlUnescape(s: string): string {
  return (s || "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X"
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[ent] ?? m;
  });
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Retire le préfixe « Tout savoir sur l'article <titre> » que le feed colle devant chaque description.
// Le titre est collé sans séparateur (« ergotsChacun… ») : on reconstruit le motif à partir des MOTS
// du titre pour rester tolérant aux espaces multiples.
function cleanDesc(raw: string, title: string): string {
  let s = htmlUnescape(raw || "").replace(/\t/g, " ").replace(/\u00a0/g, " ");
  const words = normWs(title).split(" ").filter(Boolean);
  if (words.length) {
    const pat = new RegExp("^\\s*Tout savoir sur l'article\\s+" + words.map(reEsc).join("\\s+") + "\\s*", "i");
    s = s.replace(pat, "");
  }
  s = s.replace(/^\s*Tout savoir sur (?:l'article\s+)?/i, "");
  s = s.replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function parsePrice(r: Record<string, string>): number | null {
  const raw = (r["sale_price"] || r["price"] || "").replace(/\u00a0/g, "").replace(/ /g, "").replace(/,/g, ".");
  const v = parseFloat(raw);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

type Built = { source_uid: string; content: string; metadata: Record<string, unknown> };

function buildRow(r: Record<string, string>): Built | null {
  const title = normWs(r["title"]);
  const link = (r["link"] || "").trim();
  if (!title || !link) return null;

  const url = "https://www.bordet.fr/" + link.replace(/^\/+/, "");
  const brand = (r["brand"] || "").trim();
  const desc = cleanDesc(r["longDescription"], title);
  const price = parsePrice(r);
  const availRaw = (r["availability"] || "").trim();
  const avail = AVAIL[availRaw.toLowerCase()] ?? (availRaw || null);

  let content = title + (brand ? ` (${brand})` : "");
  if (desc) content += ` : ${desc}`;
  if (price !== null) content += "\nPrix : " + price.toFixed(2).replace(".", ",") + " € TTC";
  if (avail) content += ` — Disponibilité : ${avail}`;
  content += `\nLien : ${url}`;

  const srcUid = `product:${url}`;
  return {
    source_uid: srcUid,
    content,
    metadata: {
      source_type: "product", source: "feed", title, url,
      brand: brand || null, sku: (r["sku"] || "").trim() || null, ean: (r["ean"] || "").trim() || null,
      price, currency: "EUR", availability: avail,
      category: (r["product type"] || "").trim() || null,
      image: (r["image link"] || "").trim() || null,
      item_group_id: (r["item_group_id"] || "").trim() || null,
      source_uid: srcUid, added_via: "feed", model: EMBED_MODEL,
    },
  };
}

// CSV Oxatis : séparateur « ; », champs entre guillemets pouvant contenir des retours à la ligne.
function parseCsv(text: string, delim = ";"): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return rows.filter((r) => r.length > 1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = r[i] ?? ""; });
    return o;
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function embedAll(texts: string[], mistralKey: string): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const r = await fetch(`${MISTRAL_API_BASE}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${mistralKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: batch }),
    });
    if (!r.ok) throw new Error(`mistral embeddings ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
    const data = await r.json();
    const vs: number[][] = (data.data ?? []).map((d: { embedding: number[] }) => d.embedding);
    if (vs.length !== batch.length) throw new Error(`embed mismatch ${vs.length}/${batch.length}`);
    for (const v of vs) if (v.length !== DIM) throw new Error(`dim ${v.length} != ${DIM}`);
    vectors.push(...vs);
  }
  return vectors;
}


// ---------- récupération du feed ----------
// bordet.fr (Oxatis) filtre les clients « non navigateur » ET, semble-t-il, certaines IP de
// datacenter. On essaie plusieurs profils d'en-têtes jusqu'à obtenir un CSV valide, plutôt que
// de dépendre d'un seul. Le feed est destiné au crawler Doofinder : son UA est donc tenté aussi.
const UA_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const FEED_STRATEGIES: Array<{ name: string; headers: Record<string, string> }> = [
  { name: "chrome", headers: { "User-Agent": UA_CHROME, "Accept": "text/csv,*/*;q=0.8", "Accept-Language": "fr-FR,fr;q=0.9" } },
  { name: "chrome-min", headers: { "User-Agent": UA_CHROME } },
  { name: "chrome-referer", headers: { "User-Agent": UA_CHROME, "Accept": "*/*", "Referer": "https://www.bordet.fr/" } },
  { name: "doofinder", headers: { "User-Agent": "Doofinder-Bot/1.0 (+https://www.doofinder.com)", "Accept": "*/*" } },
  { name: "curl", headers: { "User-Agent": "curl/8.4.0", "Accept": "*/*" } },
];

// Un CSV valide commence par l'en-tête Doofinder : garde-fou contre une page d'erreur en HTTP 200.
const looksLikeFeed = (t: string) => t.slice(0, 400).includes('"id";"title"');

type FeedAttempt = { strategy: string; status: number; ok: boolean; bytes: number; server: string | null; snippet: string };

async function fetchFeed(url: string): Promise<{ csv: string; strategy: string; attempts: FeedAttempt[] }> {
  const attempts: FeedAttempt[] = [];
  for (const st of FEED_STRATEGIES) {
    try {
      const r = await fetch(url, { headers: st.headers });
      const buf = await r.arrayBuffer();
      // cp1252 obligatoire : le feed Oxatis n'est PAS en UTF-8 (sinon tous les accents cassent).
      const text = new TextDecoder("windows-1252").decode(buf);
      const good = r.ok && looksLikeFeed(text);
      attempts.push({
        strategy: st.name, status: r.status, ok: good, bytes: buf.byteLength,
        server: r.headers.get("server"), snippet: text.slice(0, 160).replace(/\s+/g, " "),
      });
      if (good) return { csv: text, strategy: st.name, attempts };
    } catch (e) {
      attempts.push({ strategy: st.name, status: 0, ok: false, bytes: 0, server: null,
                      snippet: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160) });
    }
  }
  const err = new Error("feed inaccessible : " + attempts.map((a) => `${a.strategy}=${a.status}`).join(", "));
  (err as Error & { attempts?: FeedAttempt[] }).attempts = attempts;
  throw err;
}

// ---------- serveur ----------

Deno.serve(async (req: Request) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const mistralKey = Deno.env.get("MISTRAL_API_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");

  // Garde : secret de cron OU clé service_role. Jamais ouvert au public.
  const authz = req.headers.get("Authorization") ?? "";
  const okSecret = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  const okService = !!serviceKey && authz === `Bearer ${serviceKey}`;
  if (!okSecret && !okService) return json({ error: "unauthorized" }, 401);
  if (!mistralKey) return json({ error: "MISTRAL_API_KEY manquante" }, 500);

  // Deux transports possibles :
  //  - JSON  : la fonction va chercher le feed elle-même (nominal, quand l'accès serveur est ouvert) ;
  //  - CSV   : le feed est POUSSÉ dans le corps de la requête (repli quand le WAF de bordet.fr bloque
  //            les IP de datacenter — un poste sur IP résidentielle télécharge et relaie).
  //            Corps = octets cp1252 BRUTS du CSV, éventuellement gzippés (Content-Encoding: gzip).
  const ctype = (req.headers.get("content-type") ?? "").toLowerCase();
  const qs = new URL(req.url).searchParams;
  let body: Record<string, unknown> = {};
  let pushedCsv: string | null = null;

  if (ctype.includes("gzip") || ctype.includes("csv") || ctype.includes("octet-stream")) {
    try {
      let bytes = new Uint8Array(await req.arrayBuffer());
      if (ctype.includes("gzip") || req.headers.get("content-encoding") === "gzip") {
        const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        bytes = new Uint8Array(await new Response(ds).arrayBuffer());
      }
      pushedCsv = new TextDecoder("windows-1252").decode(bytes);
    } catch (e) {
      return json({ error: `CSV poussé illisible : ${e instanceof Error ? e.message : e}` }, 400);
    }
    if (!looksLikeFeed(pushedCsv)) return json({ error: "le corps envoyé n'est pas le CSV Doofinder attendu" }, 400);
    body = { prune: qs.get("prune") !== "false", dry_run: qs.get("dry_run") === "true" };
  } else {
    body = await req.json().catch(() => ({}));
  }

  const depth: number = Number(body?.depth ?? 0);
  const prune: boolean = body?.prune !== false;
  const dryRun: boolean = body?.dry_run === true;
  const feedUrl: string = typeof body?.feed === "string" ? body.feed : FEED_URL;

  // Sonde d'authentification : ne fait aucun appel réseau et n'écrit pas dans le journal.
  if (body?.ping === true) return json({ ok: true, pong: true });

  // Mode diagnostic : ne touche à rien, sert à comprendre un blocage du feed
  // (IP de sortie des Edge Functions, en-têtes réellement reçus, réponse par stratégie).
  if (body?.diagnose === true) {
    const egress = await fetch("https://api.ipify.org?format=json").then((r) => r.json()).catch(() => null);
    const seen = await fetch("https://httpbin.org/headers", {
      headers: { "User-Agent": UA_CHROME, "Accept": "text/csv,*/*;q=0.8", "Accept-Language": "fr-FR,fr;q=0.9" },
    }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    let attempts: FeedAttempt[] = [];
    try { attempts = (await fetchFeed(feedUrl)).attempts; }
    catch (e) { attempts = (e as Error & { attempts?: FeedAttempt[] }).attempts ?? []; }
    return json({ ok: true, diagnose: true, egress_ip: egress, headers_seen_by_server: seen, feed_attempts: attempts });
  }

  const sb = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const finish = async (status: string, stats: Record<string, unknown>, httpCode = 200) => {
    await sb.from("product_sync_runs").insert({
      started_at: startedAt, finished_at: new Date().toISOString(), depth, status,
      duration_ms: Date.now() - t0, ...stats,
    });
    return json({ ok: status === "ok" || status === "partial", status, depth, ...stats }, httpCode);
  };

  try {
    // 1. Feed : soit celui qui vient d'être poussé, soit téléchargé directement.
    let csv: string, feedStrategy: string;
    if (pushedCsv) { csv = pushedCsv; feedStrategy = "push"; }
    else try {
      const got = await fetchFeed(feedUrl);
      csv = got.csv; feedStrategy = got.strategy;
    } catch (e) {
      const att = (e as Error & { attempts?: FeedAttempt[] }).attempts ?? [];
      return await finish("error", {
        error: e instanceof Error ? e.message : String(e),
        note: JSON.stringify(att).slice(0, 900),
      }, 502);
    }

    const rows = parseCsv(csv);
    const built = rows.map(buildRow).filter((b): b is Built => b !== null);
    if (!built.length) return await finish("error", { feed_rows: rows.length, error: "aucun produit exploitable dans le feed" }, 502);

    // 2. Empreintes actuelles en base -> ne retraiter que le nouveau/modifié
    const { data: fps, error: fpErr } = await sb.rpc("product_feed_fingerprints", { p_bot_id: BOT_ID });
    if (fpErr) return await finish("error", { error: `fingerprints: ${fpErr.message}` }, 500);
    const known = new Map<string, string>();
    for (const f of (fps ?? []) as Array<{ source_uid: string; fp: string }>) known.set(f.source_uid, f.fp);

    const changed: Built[] = [];
    for (const b of built) {
      if (known.get(b.source_uid) !== await sha256Hex(b.content)) changed.push(b);
    }

    const slice = changed.slice(0, MAX_PER_RUN);
    const remaining = changed.length - slice.length;

    if (dryRun) {
      return await finish("dry-run", {
        feed_rows: rows.length, products: built.length, changed: changed.length,
        would_process: slice.length, remaining,
      });
    }

    // 3. Embedder + upsert la tranche
    let upserted = 0;
    for (let i = 0; i < slice.length; i += UPSERT_BATCH) {
      const part = slice.slice(i, i + UPSERT_BATCH);
      const vectors = await embedAll(part.map((p) => p.content), mistralKey);
      const { error } = await sb.from("documents").upsert(
        part.map((p, k) => ({
          bot_id: BOT_ID, source_uid: p.source_uid, content: p.content,
          metadata: p.metadata, embedding: `[${vectors[k].join(",")}]`,
        })),
        { onConflict: "bot_id,source_uid" },
      );
      if (error) throw new Error(`upsert: ${error.message}`);
      upserted += part.length;
    }

    // 4. Purge des fiches disparues du feed — SEULEMENT quand tout le diff est absorbé,
    //    et jamais sur un feed anormalement petit.
    let deleted = 0;
    let pruneNote: string | null = null;
    if (remaining === 0 && prune) {
      if (built.length < MIN_ROWS_FOR_PRUNE) {
        pruneNote = `purge ignorée : feed anormalement petit (${built.length} < ${MIN_ROWS_FOR_PRUNE})`;
      } else {
        const { data: del, error: delErr } = await sb.rpc("product_feed_prune", {
          p_bot_id: BOT_ID, p_uids: built.map((b) => b.source_uid),
        });
        if (delErr) pruneNote = `purge échouée : ${delErr.message}`;
        else deleted = Number(del ?? 0);
      }
    }

    // 5. Reste du travail -> relance bornée (chaque invocation repart d'un diff frais)
    let chained = false;
    if (remaining > 0 && !pushedCsv && depth + 1 < MAX_CHAIN) {
      const next = fetch(`${supaUrl}/functions/v1/sync-products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${anonKey}`,
          ...(cronSecret ? { "x-cron-secret": cronSecret } : {}),
        },
        body: JSON.stringify({ depth: depth + 1, prune }),
      }).catch(() => {});
      try { (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(next); } catch { /* runtime sans waitUntil */ }
      chained = true;
    }

    return await finish(remaining > 0 ? "partial" : "ok", {
      feed_rows: rows.length, products: built.length, changed: changed.length,
      upserted, deleted, remaining, chained, note: pruneNote ?? `feed via ${feedStrategy}`,
    });
  } catch (e) {
    return await finish("error", { error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
