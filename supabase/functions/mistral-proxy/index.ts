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
const MAX_TOKENS_CLIENT = 1800;
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

OBJECTIF : être un vrai conseiller — RICHE mais CONCIS, structuré et utile — SANS jamais rien inventer.

Exploitez PLEINEMENT le contexte :
- **Chaque bloc [PRODUIT — Nom](URL) EST un produit achetable** : présentez-le avec son lien **[Nom](URL)**. Ne dites JAMAIS « aucun produit disponible » / « non listé » s'il existe au moins un bloc [PRODUIT] — listez-les.
- Présentez TOUS les produits pertinents (souvent 3 à 6), organisés par usage/budget quand c'est pertinent. Toujours un lien cliquable pour chaque produit recommandé.
- Pour chaque produit : son **[Nom exact](URL)** + les caractéristiques **telles qu'elles apparaissent dans le contexte**.
- Forme : allez à l'essentiel, PAS de remplissage, PAS d'emoji en titre, PAS de séparateurs horizontaux répétés. Terminez par 1 question de clarification.

Règles ABSOLUES (anti-invention) :
- N'énoncez JAMAIS un produit, une marque, un prix, une dimension, un angle, une durée, une température, une norme ou une référence qui ne figure pas LITTÉRALEMENT dans le contexte. Absent → ne l'inventez pas (dites « non précisé sur la fiche »).
- N'inventez JAMAIS de référence produit (numéro), de code normatif (FDA, EN, USP…), de TPI, ni d'appariement référence↔caractéristique. C'est la même prudence que pour les prix : appliquez-la AUSSI aux specs techniques.
- N'affirmez JAMAIS une portée exhaustive : proscrivez « exclusivement », « les seuls modèles », « la gamme se limite à ». Sur une question d'ensemble (marques, essences, modèles), écrivez « voici ce que je trouve dans le catalogue, il peut en exister d'autres ».
- N'affirmez l'existence d'un produit QUE s'il vient d'un bloc [PRODUIT] (avec son lien). N'inventez jamais un « type » de produit qui n'est pas une vraie fiche.
- Reprenez le nom EXACT du produit ; ne réutilisez jamais une URL pour deux produits différents.
- Conseil général absent du contexte = marqué « à titre indicatif, conseil général » ; jamais attribué à un guide Bordet ; jamais mêlé aux produits cliquables. N'écrivez jamais « tout est sourcé ».
- Ne renvoyez JAMAIS le client vers un concurrent (scierie, autre magasin, « ailleurs », « en ligne »). Bordet vend du bois (essences variées) et de nombreux outils : orientez TOUJOURS vers Bordet — citez les produits du contexte, ou invitez à préciser le besoin pour chercher dans le catalogue Bordet.
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
    // URLs présentes dans le CONTENU des chunks (ex. chunk-catalogue « Lien : … ») = réelles (issues du corpus)
    for (const cm of (m.content || "").matchAll(/https:\/\/www\.bordet\.fr\/[^\s)\]]+/g)) valid.add(cm[0]);
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

    // 2) retrieval HYBRIDE (vectoriel + lexical plein-texte) via match_documents_hybrid.
    //    Le lexical fait remonter les produits que le vecteur seul rate (marques diverses,
    //    essences de bois nommées). Fallback match_documents si la fonction n'existe pas encore.
    const rpc = (name: string, payload: unknown) =>
      fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: env("SUPABASE_ANON_KEY"), Authorization: `Bearer ${env("SUPABASE_ANON_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    const retrieveOne = async (emb: number[], text: string): Promise<Match[]> => {
      const qe = `[${emb.join(",")}]`;
      try {
        const r = await rpc("match_documents_hybrid", { query_embedding: qe, query_text: text, match_count: MATCH_COUNT, filter_bot_id: "bot1" });
        if (r.ok) return await r.json();
      } catch { /* fallback ci-dessous */ }
      const r2 = await rpc("match_documents", { query_embedding: qe, match_count: MATCH_COUNT, filter_bot_id: "bot1" }).catch(() => null);
      return r2 && r2.ok ? await r2.json() : [];
    };
    const lists: Match[][] = await Promise.all(embeddings.map((emb, i) => retrieveOne(emb, queries[i])));

    // fusion : interleave (priorité au 1er = message courant), dédup par URL, top MATCH_COUNT
    const seenKeys = new Set<string>();
    const matches: Match[] = [];
    for (let i = 0; i < MATCH_COUNT && matches.length < MATCH_COUNT; i++) {
      for (const list of lists) {
        const m = list[i];
        if (!m) continue;
        const key = m.metadata?.url ?? m.content.slice(0, 60);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key); matches.push(m);
        if (matches.length >= MATCH_COUNT) break;
      }
    }

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
    // prompts éditables + modèle de chat configurable depuis le backoffice (widget_settings) ; fallback constantes
    const { data: ws } = await sb.from("widget_settings").select("client_prompt, marketing_prompt, chat_model").eq("id", 1).maybeSingle();
    const clientP = (ws?.client_prompt || "").trim() || CLIENT_PROMPT;
    const mktP = (ws?.marketing_prompt || "").trim() || MARKETING_PROMPT;
    const sys = `${marketing ? mktP : clientP}\n\nContexte de la base de connaissances:\n${context}`;
    const messages = [{ role: "system", content: sys }, ...history, { role: "user", content: userMessage }];

    // 5) génération : chat client -> OpenRouter si configuré (modèle FORCÉ serveur via widget_settings.chat_model,
    //    ex. "qwen/qwen3.7-plus") ; sinon Mistral (marketing reste large). Embeddings restent Mistral.
    const orKey = Deno.env.get("OPENROUTER_API_KEY");
    const orModel = (ws?.chat_model || "").trim();
    const useOR = !marketing && !!orKey && !!orModel;
    const cr = useOR
      ? await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${orKey}`, "Content-Type": "application/json",
                     "HTTP-Referer": "https://chatbordet.netlify.app", "X-Title": "Bordet Assistant" },
          // reasoning désactivé : latence prod (un chatbot ne peut pas raisonner 1-3 min/réponse)
          body: JSON.stringify({ model: orModel, messages, temperature: TEMPERATURE, max_tokens: maxTokens, stream: false, reasoning: { enabled: false } }),
        })
      : await mistral("/chat/completions", { model, messages, temperature: TEMPERATURE, max_tokens: maxTokens, stream: false });
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
