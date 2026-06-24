// mistral-proxy — DURCI (P0) + RAG CÔTÉ SERVEUR.
// Le RAG est désormais appliqué par le serveur : embed + match_documents + assemblage du
// prompt + sanitization des URLs se font ICI. Le client n'envoie que { message, mode }.
// => Aucune réponse possible sans RAG, même via un appel direct à l'API.
//
// Garde-fous conservés : modèle forcé (small ; large seulement si marketing + admin authentifié),
// température 0.1, bornes de taille, allowlist d'origine, circuit-breaker de coût, kill-switch.
// Prérequis SQL : reserve/reconcile_token_budget + match_documents (déjà déployés).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MISTRAL_API_BASE = "https://api.mistral.ai/v1";
const SMALL = "mistral-small-latest";
const MEDIUM = "mistral-medium-latest";
const LARGE = "mistral-large-latest";
const EMBED_MODEL = "mistral-embed";
const TEMPERATURE = 0.1;
const MAX_TOKENS_CLIENT = 1200;
const MAX_TOKENS_MKT = 2000;
const DAILY_TOKEN_CAP = 2_000_000;
const RESERVE_CLIENT = 10000;
const RESERVE_MKT = 16000;
const MAX_BODY_BYTES = 80 * 1024;
const MAX_USER_CHARS = 2000;     // message utilisateur (unique)
const MAX_HISTORY = 6;           // tours d'historique repris
const MAX_EMBED_CHARS = 2000;
const MATCH_COUNT = 15;

const ALLOWED_ORIGINS = new Set([
  "https://chatbordet.netlify.app",
  "https://www.bordet.fr",
  "https://bordet.fr",
]);

// Prompts assemblés côté serveur (le client ne peut plus les fournir).
const CLIENT_PROMPT =
`Vous êtes l'assistant commercial de **Bordet** (outillage, ébénisterie, travail du bois).
Répondez en français, en Markdown, en utilisant EXCLUSIVEMENT la base de connaissances ci-dessous.

Le contexte est une liste de blocs étiquetés. Chaque bloc commence par son en-tête :
- **[PRODUIT — Nom](URL)** = une fiche produit ACHETABLE chez Bordet. L'URL est le lien à citer.
- **[GUIDE — Titre](URL)** = un article de blog (savoir, technique).
- **[EXTRAIT DE LIVRE — …]** = une référence d'ouvrage.
N'affichez JAMAIS ces étiquettes ni le mot « contexte » dans la réponse.

OBJECTIF : être un vrai conseiller — RICHE, structuré et utile — SANS jamais rien inventer.

Exploitez PLEINEMENT le contexte :
- **Chaque bloc [PRODUIT — Nom](URL) EST un produit achetable** : présentez-le comme tel avec son lien **[Nom](URL)**. Ne dites JAMAIS qu'« aucun produit n'est disponible » ou « non listé comme achetable » s'il existe au moins un bloc [PRODUIT] dans le contexte — listez-les.
- Présentez TOUS les produits pertinents (souvent 3 à 6 quand le contexte est riche), pas un seul. Organisez-les par usage, niveau ou budget quand c'est pertinent (ex. « Pour l'atelier », « Pour les retouches », « Pour approfondir » avec un livre/guide).
- Pour chaque produit : son **[Nom exact](URL)** + les caractéristiques **telles qu'elles apparaissent dans le contexte** (puissance, largeur, poids, matériau, angle…).
- Terminez par 1 à 2 questions de clarification utiles (taille des pièces, budget, bois dur/tendre…).

Règles ABSOLUES (anti-invention) :
- N'énoncez JAMAIS un produit/modèle, une marque, une référence, un prix, une dimension, un angle, une durée, une température ou une norme qui ne figure pas LITTÉRALEMENT dans le contexte. Donnée absente → ne l'inventez pas (ne l'écrivez pas, ou dites « non précisé »).
- N'affirmez l'existence d'un produit QUE s'il provient d'un bloc [PRODUIT] : citez-le avec son lien. N'inventez jamais de « type » de produit qui ne soit pas une vraie fiche [PRODUIT].
- Reprenez le nom EXACT du produit (jamais inventé) ; ne réutilisez jamais une URL pour deux produits différents.
- Tout conseil général absent du contexte = à marquer « à titre indicatif » ; ne l'attribuez jamais à un guide Bordet. N'écrivez jamais « tout est sourcé » ni « rien n'est inventé ».
- L'avoyage / l'égalisation des dents ne concernent QUE les scies, jamais un ciseau, une gouge ou un fer de rabot.`

const MARKETING_PROMPT =
`Vous êtes l'assistant de rédaction marketing de **Bordet** (outillage, ébénisterie, travail du bois).
Aidez à rédiger des billets de blog et du contenu, en français, en Markdown.
Appuyez-vous EXCLUSIVEMENT sur la base de connaissances ci-dessous ; n'inventez jamais de données,
de produits ni d'URLs. Structure d'article : titre, intro, sections (##/###), points clés en gras,
conclusion avec appel à l'action. Citez les produits via leur URL réelle au format **[Nom](URL)**.`;

const NO_INFO = "Je n'ai pas d'information à ce sujet dans la base de connaissances Bordet. Pouvez-vous reformuler ou préciser votre besoin ?";

function corsFor(origin: string | null) {
  const allow = !!origin && ALLOWED_ORIGINS.has(origin);
  return {
    "Access-Control-Allow-Origin": allow ? (origin as string) : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    "Vary": "Origin",
  };
}

// Rôle de l'appelant depuis le JWT (signature validée par verify_jwt). Borne de coût = filet final.
function callerRole(req: Request): string {
  try {
    const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const p = tok.split(".")[1];
    if (!p) return "anon";
    let b64 = p.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return JSON.parse(atob(b64))?.role || "anon";
  } catch { return "anon"; }
}

const env = (k: string) => Deno.env.get(k)!;
const admin = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

// ---- sanitization URLs (identique au front : seules les URLs des chunks récupérés survivent) ----
const norm = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
function sanitizeUrls(response: string, matches: Array<{ content?: string; metadata?: { url?: string; title?: string } }>): string {
  const valid = new Set<string>();
  const urlToTitle = new Map<string, string>();
  const nameToUrl = new Map<string, string>();
  const ctxPrices = new Set<string>();
  let ctxText = "";
  for (const m of matches) {
    const url = m.metadata?.url, title = m.metadata?.title;
    if (url && url.startsWith("https://www.bordet.fr/")) {
      valid.add(url);
      if (title) { urlToTitle.set(url, title); nameToUrl.set(norm(title), url); }
    }
    ctxText += " " + (m.content || "");
    for (const pm of (m.content || "").matchAll(/(\d+(?:[.,]\d+)?)\s*(?:€|EUR)/gi)) {
      ctxPrices.add(pm[1].replace(",", ".").replace(/\.0+$/, ""));
    }
  }
  // 1) liens : url réelle -> libellé = VRAI titre ; sinon rattraper via le nom, sinon retirer l'URL
  let out = response.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (full, text, url) => {
    if (valid.has(url)) { const t = urlToTitle.get(url); return t ? `[${t}](${url})` : full; }
    const nt = norm(text);
    for (const [name, u] of nameToUrl) {
      if (name && (nt === name || nt.includes(name) || name.includes(nt))) return `[${urlToTitle.get(u) ?? text}](${u})`;
    }
    return text;
  });
  // 2) URLs nues non valides -> retirées
  out = out.replace(/(?<![(\]])https?:\/\/[^\s)]+/g, (url) => (valid.has(url) ? url : ""));
  // 3) protéger liens + URLs avant les filtres numériques (pour ne pas toucher aux IDs c2x/c1200x)
  const tok: string[] = [];
  out = out.replace(/(\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/g, (m) => { tok.push(m); return `\u0000${tok.length - 1}\u0000`; });
  // 4) prix € absents des fiches -> neutralisés
  out = out.replace(/(\d+(?:[.,]\d+)?)\s*(?:€|euros?)/gi, (full, num) => {
    const n = String(num).replace(",", ".").replace(/\.0+$/, "");
    return ctxPrices.has(n) ? full : "(voir le prix sur la fiche produit)";
  });
  // 5) réfs/SKU (5-7 chiffres) absents du contexte -> neutralisés
  out = out.replace(/\b\d{5,7}\b/g, (m) => (ctxText.includes(m) ? m : "(voir la fiche)"));
  // 6) restaurer les liens/URLs protégés
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => tok[+i] ?? "");
  return out;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = corsFor(origin);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "origin not allowed" }, 403);

  const url = new URL(req.url);
  const path = url.pathname.split("/mistral-proxy")[1] || "";

  if (req.method === "GET" && (path === "/models" || path === "")) {
    return json({ data: [{ id: SMALL }, { id: LARGE }, { id: EMBED_MODEL }] });
  }

  const apiKey = Deno.env.get("MISTRAL_API_KEY");
  if (!apiKey) return json({ error: "MISTRAL_API_KEY not configured" }, 500);
  if (Number(req.headers.get("Content-Length") || "0") > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const sb = admin();
  const reserve = async (n: number) => {
    const { data, error } = await sb.rpc("reserve_token_budget", { p_reserve: n, p_cap: DAILY_TOKEN_CAP });
    return !error && data === true;
  };
  const reconcile = async (real: number, reserved: number) => { await sb.rpc("reconcile_token_budget", { p_delta: real - reserved }); };

  const mistral = (p: string, payload: unknown) => fetch(`${MISTRAL_API_BASE}${p}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // -------- CHAT (RAG côté serveur) --------
  if (req.method === "POST" && path === "/chat") {
    // message utilisateur : { message } (nouveau) OU dernier message user de { messages } (rétro-compat)
    let userMessage: string | undefined = typeof body?.message === "string" ? body.message : undefined;
    if (!userMessage && Array.isArray(body?.messages)) {
      const last = [...body.messages].reverse().find((m: any) => m?.role === "user" && typeof m?.content === "string");
      userMessage = last?.content;
    }
    if (typeof userMessage !== "string" || !userMessage.trim() || userMessage.length > MAX_USER_CHARS)
      return json({ error: "message invalide" }, 400);

    const mode = body?.mode === "marketing" ? "marketing" : "client";
    const marketing = mode === "marketing" && callerRole(req) === "authenticated";
    const model = marketing ? LARGE : MEDIUM;  // client -> medium, marketing -> large
    const maxTokens = marketing ? MAX_TOKENS_MKT : MAX_TOKENS_CLIENT;
    const reserveN = marketing ? RESERVE_MKT : RESERVE_CLIENT;

    // historique (optionnel, fourni par le client) — uniquement des tours user/assistant
    const history: Array<{ role: string; content: string }> = Array.isArray(body?.history)
      ? body.history.filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
          .slice(-MAX_HISTORY)
      : [];

    if (!(await reserve(reserveN)))
      return json({ error: "Service très demandé, merci de réessayer plus tard." }, 503);

    // Retrieval robuste multi-tour : on lance DEUX requêtes et on fusionne.
    //  (a) message courant SEUL   -> capte l'intention explicite (ex. "un trusquin ?")
    //  (b) requête history-aware  -> capte les suivis elliptiques (ex. "d'autres marques ?")
    // Sans (a), le sujet du tour précédent (ex. "scie") dilue le nouveau et fait rater ses produits.
    type Match = { content: string; metadata?: { url?: string; title?: string }; similarity?: number };
    const recentUser = history.filter((m) => m.role === "user").slice(-2).map((m) => m.content);
    const qSolo = userMessage.slice(0, MAX_EMBED_CHARS);
    const qHist = [...recentUser, userMessage].join("\n").slice(0, MAX_EMBED_CHARS);
    const queries = recentUser.length && qHist !== qSolo ? [qSolo, qHist] : [qSolo];

    // 1) embeddings (parallèle)
    const embRes = await Promise.all(queries.map((q) => mistral("/embeddings", { model: EMBED_MODEL, input: q })));
    const embeddings: number[][] = [];
    for (const er of embRes) {
      const e = er.ok ? (await er.json())?.data?.[0]?.embedding : null;
      if (!Array.isArray(e)) { await reconcile(0, reserveN); return json({ error: "embedding failed" }, 502); }
      embeddings.push(e);
    }

    // 2) retrieval (parallèle) via match_documents (anon -> livres exclus du public)
    const lists: Match[][] = await Promise.all(embeddings.map((emb) =>
      fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/match_documents`, {
        method: "POST",
        headers: { apikey: env("SUPABASE_ANON_KEY"), Authorization: `Bearer ${env("SUPABASE_ANON_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query_embedding: `[${emb.join(",")}]`, match_count: MATCH_COUNT, filter_bot_id: "bot1" }),
      }).then((r) => (r.ok ? r.json() : [])).catch(() => [] as Match[])
    ));

    // fusion : meilleure similarité par URL, tri décroissant, top MATCH_COUNT
    const byKey = new Map<string, Match>();
    for (const list of lists) for (const m of list) {
      const key = m.metadata?.url ?? m.content.slice(0, 60);
      const prev = byKey.get(key);
      if (!prev || (m.similarity ?? 0) > (prev.similarity ?? 0)) byKey.set(key, m);
    }
    const matches = [...byKey.values()].sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)).slice(0, MATCH_COUNT);

    // 3) aucun contexte -> pas d'appel LLM, message canné (donc JAMAIS de réponse "libre")
    if (!matches.length) {
      await reconcile(50, reserveN);
      return json({ model, choices: [{ message: { role: "assistant", content: NO_INFO } }], usage: { total_tokens: 50 } });
    }

    // 4) assemblage serveur : prompt + contexte RAG (le client ne contrôle ni l'un ni l'autre)
    const context = matches.map((m) => {
      const u = m.metadata?.url || "";
      const ti = m.metadata?.title ? " — " + m.metadata.title : "";
      const type = /c2x\d/.test(u) ? "PRODUIT" : /c1200x\d/.test(u) ? "GUIDE" : "EXTRAIT DE LIVRE";
      // URL dans l'en-tête : le modèle a un lien markdown prêt à citer pour chaque produit.
      const head = u ? `[${type}${ti}](${u})` : `[${type}${ti}]`;
      return `${head}\n${m.content}`;
    }).filter(Boolean).join("\n\n");
    // prompts éditables depuis le backoffice (widget_settings) ; fallback constantes
    const { data: ws } = await sb.from("widget_settings").select("client_prompt, marketing_prompt").eq("id", 1).maybeSingle();
    const clientP = (ws?.client_prompt || "").trim() || CLIENT_PROMPT;
    const mktP = (ws?.marketing_prompt || "").trim() || MARKETING_PROMPT;
    const sys = `${marketing ? mktP : clientP}\n\nContexte de la base de connaissances:\n${context}`;
    const messages = [{ role: "system", content: sys }, ...history, { role: "user", content: userMessage }];

    // 5) génération
    const cr = await mistral("/chat/completions", { model, messages, temperature: TEMPERATURE, max_tokens: maxTokens, stream: false });
    const data = await cr.json().catch(() => null);
    const used = cr.ok && typeof data?.usage?.total_tokens === "number" ? data.usage.total_tokens : reserveN;
    await reconcile(used, reserveN);
    if (!cr.ok || !data?.choices?.[0]?.message) return json(data ?? { error: "upstream error" }, cr.status);

    // 6) sanitization URLs serveur (seules les URLs des chunks récupérés survivent)
    data.choices[0].message.content = sanitizeUrls(String(data.choices[0].message.content ?? ""), matches);
    return json(data, 200);
  }

  // -------- EMBEDDINGS (string unique ; conservé pour usages internes éventuels) --------
  if (req.method === "POST" && path === "/embeddings") {
    const input = body?.input;
    if (typeof input !== "string" || !input.length || input.length > MAX_EMBED_CHARS)
      return json({ error: `input doit être une string <= ${MAX_EMBED_CHARS} caractères` }, 400);
    if (!(await reserve(1200))) return json({ error: "Service très demandé." }, 503);
    const r = await mistral("/embeddings", { model: EMBED_MODEL, input });
    const data = await r.json().catch(() => null);
    const used = r.ok && typeof data?.usage?.total_tokens === "number" ? data.usage.total_tokens : 1200;
    await reconcile(used, 1200);
    return json(data ?? { error: "upstream error" }, r.status);
  }

  return json({ error: "Not found" }, 404);
});
