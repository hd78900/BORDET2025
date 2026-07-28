import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, MessagesSquare, AlertTriangle, Euro, Timer, RefreshCw, X, ExternalLink, PlusCircle, Loader2, Sparkles, Gauge, EyeOff, Phone, Mail,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { supabase } from '../lib/supabase';

// ---- coûts estimés (USD / 1M tokens) — approximations pour l'ordre de grandeur, pas la compta
const PRICES: Record<string, { inp: number; out: number }> = {
  'openai/gpt-5.4-nano': { inp: 0.20, out: 1.25 },
  'google/gemini-3.5-flash-lite': { inp: 0.10, out: 0.40 },
  'mistral-medium-latest': { inp: 0.40, out: 2.00 },
  'mistral-large-latest': { inp: 2.00, out: 6.00 },
  'mistral-small-latest': { inp: 0.10, out: 0.30 },
};
const DEFAULT_PRICE = { inp: 0.40, out: 2.00 };
// plafond quotidien du circuit-breaker (affichage) — garder synchro avec DAILY_TOKEN_CAP du proxy
const DAILY_CAP_TOKENS = 3_000_000;

const TOPIC_LABELS: Record<string, string> = {
  'affutage': 'Affûtage', 'tournage': 'Tournage', 'scies': 'Scies', 'rabots': 'Rabots',
  'ciseaux-gouges': 'Ciseaux & gouges', 'bois-essences': 'Bois & essences',
  'accessoires-atelier': 'Accessoires atelier', 'finition': 'Finition',
  'prix-livraison': 'Prix & livraison', 'sav': 'SAV', 'hors-sujet': 'Hors sujet', 'autre': 'Autre',
};
const OUTCOME_BADGE: Record<string, string> = {
  'repondu': 'bg-green-50 text-green-700', 'sans-reponse': 'bg-amber-50 text-amber-700',
  'insatisfait': 'bg-red-50 text-red-700',
};
// détection des coordonnées laissées par un client dans ses messages
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?<!\d)(?:\+33[\s.-]?|0)[1-9](?:[\s.-]?\d{2}){4}(?!\d)/;
// coordonnées propres à Bordet (à ne pas prendre pour un lead client)
const OWN_CONTACTS = new Set(['0141534040', 'info@bordet.fr']);

interface LogRow {
  id: number; created_at: string; conversation_id: string; origin: string; mode: string;
  model: string | null; question: string; no_info: boolean; match_count: number | null;
  top_similarity: number | null; sources_cited: string[] | null;
  prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null;
  latency_ms: number | null; topic: string | null; intent: string | null; outcome: string | null; ignored: boolean;
}
interface Transcript { question: string; answer: string; created_at: string; }

const day = (iso: string) => iso.slice(0, 10);
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const cost = (r: LogRow) => {
  const p = PRICES[r.model ?? ''] ?? DEFAULT_PRICE;
  if (r.prompt_tokens != null && r.completion_tokens != null)
    return (r.prompt_tokens * p.inp + r.completion_tokens * p.out) / 1e6;
  return ((r.total_tokens ?? 0) * (p.inp + p.out) / 2) / 1e6;
};
const prettySlug = (url: string) => {
  const seg = url.split('/').pop() ?? url;
  return seg.replace(/-c\d+x\d+.*$/i, '').replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
};

export default function Analytics() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [budgetUsed, setBudgetUsed] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [digesting, setDigesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openConv, setOpenConv] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript[]>([]);

  const runDigest = async () => {
    // digest paresseux : classification IA des conversations en attente (boucle jusqu'à épuisement)
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analytics`;
    for (let i = 0; i < 6; i++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'digest' }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setDigesting(null); return; }
      if (!d.pending) { setDigesting(null); return; }
      setDigesting(`Analyse IA en cours… ${d.pending} conversation${d.pending > 1 ? 's' : ''} restante${d.pending > 1 ? 's' : ''}`);
    }
    setDigesting(null);
  };

  const load = async () => {
    setLoading(true); setError(null);
    try {
      setDigesting('Analyse IA des nouvelles conversations…');
      await runDigest();
      const since = new Date(Date.now() - 90 * 86400_000).toISOString();
      const { data, error } = await supabase.from('chat_logs')
        .select('id, created_at, conversation_id, origin, mode, model, question, no_info, match_count, top_similarity, sources_cited, prompt_tokens, completion_tokens, total_tokens, latency_ms, topic, intent, outcome, ignored')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(5000);
      if (error) throw error;
      setRows((data ?? []) as LogRow[]);
      // jauge du circuit-breaker : consommation de tokens du jour (policy lecture admin)
      const today = new Date().toISOString().slice(0, 10);
      const { data: bud } = await supabase.from('daily_token_budget')
        .select('tokens_used').eq('day', today).maybeSingle();
      setBudgetUsed(bud?.tokens_used ?? 0);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); setDigesting(null); }
  };
  useEffect(() => { load(); }, []);

  const openTranscript = async (convId: string) => {
    setOpenConv(convId); setTranscript([]);
    const { data } = await supabase.from('chat_logs')
      .select('question, answer, created_at').eq('conversation_id', convId).order('created_at');
    setTranscript((data ?? []) as Transcript[]);
  };

  // clé de regroupement d'une question (identique à l'agrégation « trous de la base »)
  const qKey = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);

  // « Ajouter une réponse » : ouvre la base de connaissances pré-remplie avec la question.
  const addAnswer = (q: string) => navigate('/knowledge', { state: { prefill: { title: q } } });

  // « Ignorer » : retire durablement la question de la liste (flag `ignored` en base, pour tous les admins).
  const ignoreQuestion = async (q: string) => {
    const key = qKey(q);
    const ids = rows
      .filter((r) => !r.ignored && (r.no_info || r.outcome === 'sans-reponse') && qKey(r.question) === key)
      .map((r) => r.id);
    if (!ids.length) return;
    setRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, ignored: true } : r)));   // masquage optimiste
    const { error } = await supabase.from('chat_logs').update({ ignored: true }).in('id', ids);
    if (error) setError(`Impossible d'ignorer : ${error.message}`);
  };

  // ---------- agrégats ----------
  const agg = useMemo(() => {
    const now = Date.now();
    const d7 = now - 7 * 86400_000, d30 = now - 30 * 86400_000;
    const r7 = rows.filter((r) => Date.parse(r.created_at) >= d7);
    const r30 = rows.filter((r) => Date.parse(r.created_at) >= d30);

    // une réponse est un "trou" si le RAG n'a rien remonté (no_info) OU si le digest IA l'a classée
    // sans réponse — sauf si un admin l'a explicitement ignorée.
    const isGap = (r: LogRow) => !r.ignored && (r.no_info || r.outcome === 'sans-reponse');
    const convs7 = new Set(r7.map((r) => r.conversation_id)).size;
    const gapConvs7 = new Set(r7.filter(isGap).map((r) => r.conversation_id)).size;
    const cost7 = r7.reduce((s, r) => s + cost(r), 0);
    const cost30 = r30.reduce((s, r) => s + cost(r), 0);
    const lats = r7.map((r) => r.latency_ms ?? 0).filter(Boolean).sort((a, b) => a - b);
    const medLat = lats.length ? lats[Math.floor(lats.length / 2)] : 0;

    // séries quotidiennes 30 j
    const days: Record<string, { d: string; messages: number; conversations: Set<string>; cout: number; sansRep: number }> = {};
    for (let i = 29; i >= 0; i--) {
      const d = day(new Date(now - i * 86400_000).toISOString());
      days[d] = { d, messages: 0, conversations: new Set(), cout: 0, sansRep: 0 };
    }
    for (const r of r30) {
      const b = days[day(r.created_at)];
      if (!b) continue;
      b.messages++; b.conversations.add(r.conversation_id); b.cout += cost(r); if (isGap(r)) b.sansRep++;
    }
    const series = Object.values(days).map((b) => ({
      jour: fmtDay(b.d), messages: b.messages, conversations: b.conversations.size,
      cout: Math.round(b.cout * 10000) / 10000, sansRep: b.sansRep,
    }));

    // thèmes (conversations analysées, 30 j)
    const topicByConv = new Map<string, string>();
    for (const r of r30) if (r.topic && !topicByConv.has(r.conversation_id)) topicByConv.set(r.conversation_id, r.topic);
    const topicCounts: Record<string, number> = {};
    for (const t of topicByConv.values()) topicCounts[t] = (topicCounts[t] ?? 0) + 1;
    const topics = Object.entries(topicCounts).map(([t, n]) => ({ theme: TOPIC_LABELS[t] ?? t, n }))
      .sort((a, b) => b.n - a.n).slice(0, 8);

    // intentions
    const intentByConv = new Map<string, string>();
    for (const r of r30) if (r.intent && !intentByConv.has(r.conversation_id)) intentByConv.set(r.conversation_id, r.intent);
    const intentCounts: Record<string, number> = {};
    for (const t of intentByConv.values()) intentCounts[t] = (intentCounts[t] ?? 0) + 1;

    // produits cités (30 j)
    const prodCounts: Record<string, number> = {};
    for (const r of r30) for (const u of (r.sources_cited ?? [])) if (/-c2x\d/.test(u)) prodCounts[u] = (prodCounts[u] ?? 0) + 1;
    const products = Object.entries(prodCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topProduct = products[0] ? prettySlug(products[0][0]) : '—';

    // questions sans réponse / trous de la base (30 j) : classées "sans-reponse" par l'IA (ou zéro contexte),
    // en excluant le hors-sujet (pas un trou de la base) et les messages trop courts (relances/politesses).
    const unanswered: Record<string, { q: string; n: number; last: string }> = {};
    for (const r of r30) {
      if (!isGap(r) || r.topic === 'hors-sujet') continue;
      const q = (r.question || '').trim();
      if (q.split(/\s+/).filter(Boolean).length < 3) continue;
      const k = q.toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
      const u = unanswered[k] ?? { q, n: 0, last: r.created_at };
      u.n++; if (r.created_at > u.last) u.last = r.created_at;
      unanswered[k] = u;
    }
    const unansweredTop = Object.values(unanswered).sort((a, b) => b.n - a.n).slice(0, 10);

    // conversations récentes (50 dernières)
    const convMap = new Map<string, { id: string; start: string; origin: string; topic: string | null; outcome: string | null; first: string; n: number }>();
    for (const r of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      const c = convMap.get(r.conversation_id);
      if (!c) convMap.set(r.conversation_id, { id: r.conversation_id, start: r.created_at, origin: r.origin, topic: r.topic, outcome: r.outcome, first: r.question, n: 1 });
      else { c.n++; c.topic = c.topic ?? r.topic; c.outcome = r.outcome ?? c.outcome; }
    }
    const convs = [...convMap.values()].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 50);

    // contacts (email / téléphone) laissés par les clients dans leurs messages -> liste « à rappeler »
    const byConvAll = new Map<string, LogRow[]>();
    for (const r of rows) { const arr = byConvAll.get(r.conversation_id); if (arr) arr.push(r); else byConvAll.set(r.conversation_id, [r]); }
    const leads: { id: string; date: string; email: string | null; phone: string | null; need: string; topic: string | null }[] = [];
    for (const [cid, rs] of byConvAll) {
      const sorted = [...rs].sort((a, b) => a.created_at.localeCompare(b.created_at));
      let email: string | null = null, phone: string | null = null;
      for (const r of sorted) {
        const q = r.question || '';
        if (!email) { const m = q.match(EMAIL_RE); if (m && !OWN_CONTACTS.has(m[0].toLowerCase())) email = m[0]; }
        if (!phone) { const m = q.match(PHONE_RE); if (m && !OWN_CONTACTS.has(m[0].replace(/\D/g, ''))) phone = m[0].replace(/[.\s]+/g, ' ').trim(); }
      }
      if (!email && !phone) continue;
      // ne surface que les leads issus du flux de capture : conversation où Raymond n'a PAS pu répondre
      // (échec = no_info ou classée « sans-reponse » par l'IA). On écarte ainsi les coordonnées données
      // dans une conversation déjà résolue (pas un vrai lead de rappel).
      if (!sorted.some((x) => x.no_info || x.outcome === 'sans-reponse')) continue;
      const need = sorted.map((r) => r.question).find((q) => q && !EMAIL_RE.test(q) && q.replace(PHONE_RE, '').trim().length > 8) || sorted[0].question;
      leads.push({ id: cid, date: sorted[0].created_at, email, phone, need, topic: sorted.find((r) => r.topic)?.topic ?? null });
    }
    leads.sort((a, b) => b.date.localeCompare(a.date));

    return { convs7, msgs7: r7.length, noInfoRate7: convs7 ? Math.round(100 * gapConvs7 / convs7) : 0,
             cost7, cost30, medLat, series, topics, intentCounts, products, topProduct, unansweredTop, convs, leads };
  }, [rows]);

  const Kpi = ({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-start gap-3">
      <div className="p-2 bg-red-50 rounded-lg"><Icon className="h-5 w-5 text-red-950" /></div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-900">{value}</p>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-7 w-7 text-red-950" />
          <h1 className="text-2xl font-bold text-gray-900">Analytics conversations</h1>
        </div>
        <button onClick={load} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>

      {digesting && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2 bg-red-50 text-red-950 rounded-lg text-sm">
          <Sparkles className="h-4 w-4" /> {digesting}
        </div>
      )}
      {error && <div className="mb-4 px-4 py-3 bg-red-50 text-red-800 rounded-lg text-sm">{error}</div>}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-16 justify-center"><Loader2 className="h-5 w-5 animate-spin" /> Chargement…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-gray-400 text-sm">
          Aucune conversation enregistrée pour l'instant. Les échanges du widget public sont journalisés
          automatiquement dès le prochain déploiement du proxy — revenez après quelques conversations.
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
            <Kpi icon={MessagesSquare} label="Conversations (7 j)" value={String(agg.convs7)} sub={`${agg.msgs7} échanges`} />
            <Kpi icon={AlertTriangle} label="Sans réponse (7 j)" value={`${agg.noInfoRate7} %`} sub="des conversations" />
            <Kpi icon={Euro} label="Coût estimé (7 j)" value={`$${agg.cost7.toFixed(2)}`} sub={`30 j : $${agg.cost30.toFixed(2)}`} />
            <Kpi icon={Gauge} label="Budget IA du jour"
              value={budgetUsed == null ? '—' : `${Math.round(100 * budgetUsed / DAILY_CAP_TOKENS)} %`}
              sub={budgetUsed == null ? 'plafond quotidien' : `${Math.round(budgetUsed / 1000)}k / ${DAILY_CAP_TOKENS / 1_000_000}M tokens`} />
            <Kpi icon={Timer} label="Latence médiane" value={`${(agg.medLat / 1000).toFixed(1)} s`} sub="7 derniers jours" />
            <Kpi icon={ExternalLink} label="Produit n°1 (30 j)" value={agg.topProduct.slice(0, 18)} sub="le + recommandé" />
            <Kpi icon={Sparkles} label="Intention achat (30 j)" value={String(agg.intentCounts['achat'] ?? 0)} sub="conversations" />
          </div>

          {/* Contacts à rappeler (leads laissés par les clients) */}
          {agg.leads.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-green-100 mb-6">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <Phone className="h-4 w-4 text-green-600" />
                <p className="text-sm font-medium text-gray-700">Contacts à rappeler ({agg.leads.length}) — coordonnées laissées par des clients</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-50">
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-2 py-2 font-medium">Contact</th>
                      <th className="px-2 py-2 font-medium">Besoin</th>
                      <th className="px-2 py-2 font-medium text-right pr-4">Conversation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {agg.leads.map((l) => (
                      <tr key={l.id} className="hover:bg-green-50/40">
                        <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{new Date(l.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="px-2 py-2 whitespace-nowrap space-y-0.5">
                          {l.email && <a href={`mailto:${l.email}`} className="flex items-center gap-1 text-red-950 hover:underline"><Mail className="h-3.5 w-3.5 shrink-0" />{l.email}</a>}
                          {l.phone && <a href={`tel:${l.phone.replace(/\s/g, '')}`} className="flex items-center gap-1 text-red-950 hover:underline"><Phone className="h-3.5 w-3.5 shrink-0" />{l.phone}</a>}
                        </td>
                        <td className="px-2 py-2 text-gray-700 max-w-md truncate" title={l.need}>{l.need}</td>
                        <td className="px-2 py-2 text-right pr-4"><button onClick={() => openTranscript(l.id)} className="text-xs text-gray-500 hover:text-gray-900">voir</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Courbes */}
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Activité (30 jours)</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={agg.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="jour" tick={{ fontSize: 11 }} interval={4} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="messages" name="Échanges" stroke="#450a0a" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="conversations" name="Conversations" stroke="#dc2626" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="sansRep" name="Sans réponse" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Thèmes des conversations (30 jours)</p>
              {agg.topics.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={agg.topics} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="theme" tick={{ fontSize: 11 }} width={110} />
                    <Tooltip />
                    <Bar dataKey="n" name="Conversations" fill="#450a0a" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-gray-400 py-16 text-center">Classification IA en attente — rouvrez la page dans quelques minutes.</p>
              )}
            </div>
          </div>

          {/* Listes business */}
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-medium text-gray-700">Questions sans réponse (30 j) — trous de la base</p>
              </div>
              {agg.unansweredTop.length ? (
                <ul className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                  {agg.unansweredTop.map((u) => (
                    <li key={u.q} className="group flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50/60">
                      <span className="text-xs font-semibold text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 shrink-0">×{u.n}</span>
                      <span className="text-sm text-gray-700 truncate flex-1" title={u.q}>{u.q}</span>
                      <button onClick={() => addAnswer(u.q)}
                        title="Rédiger une réponse dans la base de connaissances"
                        className="flex items-center gap-1 text-xs text-white bg-red-950 hover:bg-red-800 rounded-md px-2 py-1 font-medium shrink-0">
                        <PlusCircle className="h-3.5 w-3.5" /> Ajouter une réponse
                      </button>
                      <button onClick={() => ignoreQuestion(u.q)}
                        title="Retirer cette question de la liste (pour tous les admins)"
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 shrink-0">
                        <EyeOff className="h-3.5 w-3.5" /> Ignorer
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-gray-400 px-4 py-8 text-center">Aucune question sans réponse — la base couvre. 👌</p>}
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-700">Produits les plus recommandés (30 j)</p>
              </div>
              {agg.products.length ? (
                <ul className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                  {agg.products.map(([url, n]) => (
                    <li key={url} className="flex items-center gap-2 px-4 py-2.5">
                      <span className="text-xs font-semibold text-red-950 bg-red-50 rounded px-1.5 py-0.5 shrink-0">×{n}</span>
                      <a href={url} target="_blank" rel="noreferrer" className="text-sm text-gray-700 hover:text-red-950 hover:underline truncate flex-1">
                        {prettySlug(url)}
                      </a>
                      <ExternalLink className="h-3.5 w-3.5 text-gray-300 shrink-0" />
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-gray-400 px-4 py-8 text-center">Aucun produit cité sur la période.</p>}
            </div>
          </div>

          {/* Explorateur */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-8">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-700">Dernières conversations</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-50">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-2 py-2 font-medium">Origine</th>
                    <th className="px-2 py-2 font-medium">Thème</th>
                    <th className="px-2 py-2 font-medium">Issue</th>
                    <th className="px-2 py-2 font-medium">Première question</th>
                    <th className="px-2 py-2 font-medium text-right pr-4">Tours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {agg.convs.map((c) => (
                    <tr key={c.id} onClick={() => openTranscript(c.id)} className="hover:bg-red-50/40 cursor-pointer">
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{new Date(c.start).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-2 py-2 text-gray-500">{c.origin}</td>
                      <td className="px-2 py-2 text-gray-600">{c.topic ? (TOPIC_LABELS[c.topic] ?? c.topic) : <span className="text-gray-300">…</span>}</td>
                      <td className="px-2 py-2">{c.outcome ? <span className={`text-xs rounded px-1.5 py-0.5 ${OUTCOME_BADGE[c.outcome] ?? 'bg-gray-50 text-gray-600'}`}>{c.outcome}</span> : <span className="text-gray-300">…</span>}</td>
                      <td className="px-2 py-2 text-gray-700 max-w-md truncate" title={c.first}>{c.first}</td>
                      <td className="px-2 py-2 text-right pr-4 text-gray-500">{c.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-gray-400 mb-8">
            Coûts = estimations (barème indicatif par modèle). Transcripts conservés 90 jours (purge automatique RGPD), aucun identifiant client stocké.
          </p>
        </>
      )}

      {/* Modal transcript */}
      {openConv && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setOpenConv(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-700">Transcript de la conversation</p>
              <button onClick={() => setOpenConv(null)} className="p-1 text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="overflow-y-auto p-5 space-y-4">
              {transcript.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Chargement…</p>}
              {transcript.map((t, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-end"><div className="bg-red-950 text-white rounded-2xl rounded-br-sm px-4 py-2 text-sm max-w-[85%] whitespace-pre-wrap">{t.question}</div></div>
                  <div className="flex justify-start"><div className="bg-gray-100 text-gray-800 rounded-2xl rounded-bl-sm px-4 py-2 text-sm max-w-[85%] whitespace-pre-wrap">{t.answer}</div></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
