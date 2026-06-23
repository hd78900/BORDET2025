// mistral-proxy — DURCI (P0 sécurité).
// Garde-fous indépendants de toute auth (l'anon key est publique par construction) :
//   - modèle FORCÉ serveur (mistral-small-latest) : le client ne choisit plus le modèle
//   - max_tokens + température bornés serveur
//   - bornes de taille AVANT parsing (413/400)
//   - /embeddings : string unique bornée (pas d'array -> coupe l'abus batch)
//   - circuit-breaker de coût quotidien (réservation atomique pré-appel + réconciliation)
//   - kill-switch (widget_settings.proxy_enabled)
//   - allowlist d'Origin (couche, pas barrière)
// Prérequis SQL : migration 20260616120000_p0_security_hardening.sql.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MISTRAL_API_BASE = "https://api.mistral.ai/v1";
const CHAT_MODEL = "mistral-small-latest";   // FORCÉ : on ignore body.model
const EMBED_MODEL = "mistral-embed";
const MAX_TOKENS = 600;                       // borne le coût de sortie
const DAILY_TOKEN_CAP = 2_000_000;            // plafond global / jour (ajustable)
const RESERVE_CHAT = 8000;                    // réservation pessimiste (system prompt + contexte RAG + 600 sortie)
const RESERVE_EMBED = 1200;
const MAX_BODY_BYTES = 80 * 1024;             // ~80 Ko : couvre le contexte RAG, bloque les payloads géants
const MAX_MESSAGES = 12;
const MAX_TOTAL_CHARS = 50000;                // somme des contents (système+RAG+historique+user)
const MAX_EMBED_CHARS = 2000;

const ALLOWED_ORIGINS = new Set([
  "https://chatbordet.netlify.app",
  "https://www.bordet.fr",
  "https://bordet.fr",
]);

function corsFor(origin: string | null) {
  const allow = !!origin && ALLOWED_ORIGINS.has(origin);
  return {
    "Access-Control-Allow-Origin": allow ? (origin as string) : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    "Vary": "Origin",
  };
}

// Rôle de l'appelant depuis le JWT (signature déjà validée par verify_jwt de la plateforme).
// Le plafond de coût borne la dépense même si ce gate était contourné.
function callerRole(req: Request): string {
  try {
    const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const payload = tok.split(".")[1];
    if (!payload) return "anon";
    let b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return JSON.parse(atob(b64))?.role || "anon";
  } catch { return "anon"; }
}

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = corsFor(origin);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });

  // Allowlist Origin (les requêtes navigateur hors-domaine sont coupées ; un script peut spoofer -> jamais seul)
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "origin not allowed" }, 403);

  const url = new URL(req.url);
  const path = url.pathname.split("/mistral-proxy")[1] || "";

  // /models -> liste statique (pas d'énumération facturable)
  if (req.method === "GET" && (path === "/models" || path === "")) {
    return json({ data: [{ id: CHAT_MODEL }, { id: EMBED_MODEL }] });
  }

  const apiKey = Deno.env.get("MISTRAL_API_KEY");
  if (!apiKey) return json({ error: "MISTRAL_API_KEY not configured" }, 500);

  // Borne de taille AVANT de parser le corps
  if (Number(req.headers.get("Content-Length") || "0") > MAX_BODY_BYTES)
    return json({ error: "payload too large" }, 413);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const sb = admin();
  const reserve = async (n: number) => {
    const { data, error } = await sb.rpc("reserve_token_budget", { p_reserve: n, p_cap: DAILY_TOKEN_CAP });
    if (error) return false;            // fail-closed
    return data === true;
  };
  const reconcile = async (real: number, reserved: number) => {
    await sb.rpc("reconcile_token_budget", { p_delta: real - reserved });
  };

  // -------- CHAT --------
  if (req.method === "POST" && path === "/chat") {
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES)
      return json({ error: "bad messages" }, 400);
    let total = 0;
    for (const m of messages) {
      if (typeof m?.content !== "string" || typeof m?.role !== "string")
        return json({ error: "bad message" }, 400);
      total += m.content.length;
    }
    if (total > MAX_TOTAL_CHARS) return json({ error: "messages too long" }, 413);

    // large UNIQUEMENT pour le mode marketing d'un admin authentifié ; widget public (anon) -> toujours small.
    const marketing = body?.mode === "marketing" && callerRole(req) === "authenticated";
    const model = marketing ? "mistral-large-latest" : CHAT_MODEL;
    const maxTokens = marketing ? 2000 : MAX_TOKENS;
    const reserveN = marketing ? 16000 : RESERVE_CHAT;

    if (!(await reserve(reserveN)))
      return json({ error: "Service très demandé, merci de réessayer plus tard." }, 503);

    const res = await fetch(`${MISTRAL_API_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: maxTokens, stream: false }),
    });
    const data = await res.json().catch(() => null);
    const used = res.ok && typeof data?.usage?.total_tokens === "number" ? data.usage.total_tokens : reserveN;
    await reconcile(used, reserveN);   // fail-closed : si erreur upstream, on garde la réservation
    return json(data ?? { error: "upstream error" }, res.status);
  }

  // -------- EMBEDDINGS (string unique uniquement) --------
  if (req.method === "POST" && path === "/embeddings") {
    const input = body?.input;
    if (typeof input !== "string" || input.length === 0 || input.length > MAX_EMBED_CHARS)
      return json({ error: `input doit être une string <= ${MAX_EMBED_CHARS} caractères` }, 400);

    if (!(await reserve(RESERVE_EMBED)))
      return json({ error: "Service très demandé, merci de réessayer plus tard." }, 503);

    const res = await fetch(`${MISTRAL_API_BASE}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input }),
    });
    const data = await res.json().catch(() => null);
    const used = res.ok && typeof data?.usage?.total_tokens === "number" ? data.usage.total_tokens : RESERVE_EMBED;
    await reconcile(used, RESERVE_EMBED);
    return json(data ?? { error: "upstream error" }, res.status);
  }

  return json({ error: "Not found" }, 404);
});
