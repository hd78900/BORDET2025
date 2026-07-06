// Edge Function: analytics
// ---------------------------------------------------------------------------
// Digest des conversations (chat_logs) pour le dashboard /analytics :
//   - purge RGPD : supprime les logs > 90 jours
//   - classifie les conversations non analysées (thème / intention / issue) avec un
//     modèle PAS CHER (gpt-5.4-nano via OpenRouter ; fallback mistral-small)
//
// Modèle d'exécution : PAS de cron — "lazy digest". Le dashboard appelle {action:'digest'}
// à l'ouverture et boucle tant que pending > 0. Coût uniquement quand quelqu'un regarde,
// zéro infra cron, toujours frais. (Le dashboard lit ensuite chat_logs en direct : la
// policy RLS chat_logs_select_admin réserve la lecture aux admins.)
//
// Garde : admin uniquement (auth.getUser + user_profiles.is_admin), comme ingest-documents.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CLASSIFY_MODEL_OR = "openai/gpt-5.4-nano";      // le moins cher testé au banc d'essai
const CLASSIFY_MODEL_MISTRAL = "mistral-small-latest"; // fallback si pas d'OpenRouter
const RETENTION_DAYS = 90;
const CONVS_PER_RUN = 40;      // conversations classifiées par appel (le front boucle)
const CONVS_PER_LLM = 10;      // conversations par appel LLM
const SETTLE_MINUTES = 10;     // on ne classifie pas une conversation encore active

const TOPICS = ["affutage", "tournage", "scies", "rabots", "ciseaux-gouges", "bois-essences",
                "accessoires-atelier", "finition", "prix-livraison", "sav", "hors-sujet"];
const INTENTS = ["achat", "conseil-technique", "commande-sav", "autre"];
const OUTCOMES = ["repondu", "sans-reponse", "insatisfait"];

const SYSTEM = `Tu classifies des conversations du chatbot de Bordet (vente d'outillage pour le travail du bois : tournage, affûtage, ébénisterie).
Pour CHAQUE conversation fournie, choisis :
- "topic"   parmi : ${TOPICS.join(", ")}
- "intent"  parmi : ${INTENTS.join(", ")}  (achat = cherche un produit/prix ; conseil-technique = comment faire ; commande-sav = suivi commande, retour, garantie)
- "outcome" parmi : ${OUTCOMES.join(", ")}  (sans-reponse = le bot n'a pas su répondre ; insatisfait = l'utilisateur exprime frustration ou répète sans obtenir mieux)
Réponds UNIQUEMENT un tableau JSON strict : [{"id":"<id>","topic":"...","intent":"...","outcome":"..."}] — rien d'autre.`;

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

type LogRow = { conversation_id: string; question: string; answer: string; no_info: boolean; created_at: string };
type Verdict = { id: string; topic?: string; intent?: string; outcome?: string };

async function classify(convs: Array<{ id: string; text: string }>, orKey: string | undefined, mistralKey: string): Promise<Verdict[]> {
  const user = convs.map((c) => `### Conversation id=${c.id}\n${c.text}`).join("\n\n");
  const payload = {
    temperature: 0,
    max_tokens: 1500,
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
  };
  let res: Response;
  if (orKey) {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${orKey}`, "Content-Type": "application/json",
                 "HTTP-Referer": "https://chatbordet.netlify.app", "X-Title": "Bordet Analytics" },
      body: JSON.stringify({ model: CLASSIFY_MODEL_OR, ...payload, reasoning: { enabled: false } }),
    });
  } else {
    res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${mistralKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: CLASSIFY_MODEL_MISTRAL, ...payload }),
    });
  }
  if (!res.ok) throw new Error(`classify ${res.status}`);
  const data = await res.json();
  const raw = String(data?.choices?.[0]?.message?.content ?? "");
  const m = raw.match(/\[[\s\S]*\]/);           // extrait le tableau JSON même entouré de texte
  if (!m) throw new Error("classification illisible");
  const arr = JSON.parse(m[0]);
  return Array.isArray(arr) ? arr : [];
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = corsFor(origin);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "origin not allowed" }, 403);

  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const mistralKey = Deno.env.get("MISTRAL_API_KEY");
  const orKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!supaUrl || !serviceKey || !mistralKey) return json({ error: "server not configured" }, 500);

  const sb = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

  // --- garde admin (même modèle que ingest-documents) ---
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);
  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const { data: profile } = await sb.from("user_profiles").select("is_admin").eq("id", userData.user.id).maybeSingle();
  if (!profile?.is_admin) return json({ error: "admin only" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }

  if (body?.action !== "digest") return json({ error: "action inconnue (digest)" }, 400);

  // 1) purge RGPD (> RETENTION_DAYS)
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
  const { data: purged } = await sb.from("chat_logs").delete().lt("created_at", cutoff).select("id");

  // 2) conversations en attente de classification (posées depuis > SETTLE_MINUTES)
  const { data: pendingRows, error: selErr } = await sb.from("chat_logs")
    .select("conversation_id, question, answer, no_info, created_at")
    .is("analyzed_at", null)
    .order("created_at", { ascending: true })
    .limit(600);
  if (selErr) return json({ error: selErr.message }, 500);

  const settleCutoff = Date.now() - SETTLE_MINUTES * 60_000;
  const byConv = new Map<string, LogRow[]>();
  for (const r of (pendingRows ?? []) as LogRow[]) {
    (byConv.get(r.conversation_id) ?? byConv.set(r.conversation_id, []).get(r.conversation_id)!).push(r);
  }
  // ne garder que les conversations "posées" (dernier tour assez ancien)
  const ready = [...byConv.entries()].filter(([, rows]) =>
    Math.max(...rows.map((r) => Date.parse(r.created_at))) < settleCutoff);
  const batchConvs = ready.slice(0, CONVS_PER_RUN);

  let analyzed = 0, failed = 0;
  for (let i = 0; i < batchConvs.length; i += CONVS_PER_LLM) {
    const slice = batchConvs.slice(i, i + CONVS_PER_LLM);
    const input = slice.map(([id, rows]) => {
      const qs = rows.slice(0, 4).map((r) => `Client : ${r.question.slice(0, 300)}`).join("\n");
      const lastA = rows[rows.length - 1];
      const noInfo = rows.some((r) => r.no_info);
      return { id, text: `${qs}\nBot (dernier extrait) : ${lastA.answer.slice(0, 300)}${noInfo ? "\n[NB : au moins une réponse = aucune information trouvée]" : ""}` };
    });
    try {
      const verdicts = await classify(input, orKey, mistralKey);
      const vmap = new Map(verdicts.map((v) => [String(v.id), v]));
      for (const [id, rows] of slice) {
        const v = vmap.get(id);
        const noInfo = rows.some((r) => r.no_info);
        const topic = v && TOPICS.includes(v.topic ?? "") ? v.topic : "autre";
        const intent = v && INTENTS.includes(v.intent ?? "") ? v.intent : "autre";
        // heuristique dure : si le bot a répondu "aucune info", l'issue est au moins sans-reponse
        const outcome = noInfo ? "sans-reponse" : (v && OUTCOMES.includes(v.outcome ?? "") ? v.outcome : "repondu");
        const { error: upErr } = await sb.from("chat_logs")
          .update({ topic, intent, outcome, analyzed_at: new Date().toISOString() })
          .eq("conversation_id", id).is("analyzed_at", null);
        if (upErr) failed++; else analyzed++;
      }
    } catch {
      failed += slice.length;   // batch LLM en échec : on réessaiera au prochain digest
    }
  }

  const pending = Math.max(0, ready.length - batchConvs.length);
  return json({ ok: true, analyzed, failed, pending, purged: (purged ?? []).length });
});
