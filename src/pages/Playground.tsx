import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Trash2, FlaskConical, Clock, Coins, Layers } from 'lucide-react';
import { playgroundChat, PlaygroundResult } from '../lib/api';

type Tab = 'client' | 'marketing';
type Msg = {
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  error?: boolean;
};

// Les 3 modèles testables + leur tarif OpenRouter/Mistral ($/M tokens). Doit rester aligné avec l'allowlist du proxy.
const MODELS = [
  { id: 'openai/gpt-5.4-nano', label: 'GPT-5.4 nano', in: 0.20, out: 1.25 },
  { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', in: 0.25, out: 1.50 },
  { id: 'mistral-medium-latest', label: 'Mistral medium', in: 1.50, out: 7.50 },
];
const priceOf = (id: string) => MODELS.find(m => m.id === id) ?? { id, label: id, in: 0, out: 0 };
const costUsd = (id: string, pin: number, pout: number) => (pin * priceOf(id).in + pout * priceOf(id).out) / 1e6;
const fmtUsd = (c: number) => '$' + (c < 0.01 ? c.toFixed(5) : c.toFixed(4));

const storeKey = (tab: Tab) => `playground-${tab}`;
const loadThread = (tab: Tab): Msg[] => { try { return JSON.parse(localStorage.getItem(storeKey(tab)) || '[]'); } catch { return []; } };
const saveThread = (tab: Tab, msgs: Msg[]) => localStorage.setItem(storeKey(tab), JSON.stringify(msgs));

export default function Playground() {
  const [tab, setTab] = useState<Tab>('client');
  const [model, setModel] = useState<string>(MODELS[0].id);
  const [threads, setThreads] = useState<Record<Tab, Msg[]>>({ client: loadThread('client'), marketing: loadThread('marketing') });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const msgs = threads[tab];
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, loading]);

  const setMsgs = (t: Tab, updater: (m: Msg[]) => Msg[]) =>
    setThreads(prev => { const next = { ...prev, [t]: updater(prev[t]) }; saveThread(t, next[t]); return next; });

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const curTab = tab;
    const history = threads[curTab].slice(-6).map(m => ({ role: m.role, content: m.content }));
    setInput('');
    setMsgs(curTab, m => [...m, { role: 'user', content: text }]);
    setLoading(true);
    const r: PlaygroundResult = await playgroundChat(text, curTab, history, model);
    setMsgs(curTab, m => [...m, {
      role: 'assistant', content: r.content, model, latencyMs: r.latencyMs,
      promptTokens: r.promptTokens, completionTokens: r.completionTokens,
      costUsd: costUsd(model, r.promptTokens, r.completionTokens), error: r.error,
    }]);
    setLoading(false);
  };

  const totalCost = msgs.reduce((s, m) => s + (m.costUsd || 0), 0);
  const totalTokens = msgs.reduce((s, m) => s + (m.promptTokens || 0) + (m.completionTokens || 0), 0);
  const answered = msgs.filter(m => m.role === 'assistant' && !m.error);
  const avgLatency = answered.length ? Math.round(answered.reduce((s, m) => s + (m.latencyMs || 0), 0) / answered.length) : 0;

  const Metric = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
      <span className="text-gray-400">{icon}</span>
      <div className="leading-tight"><div className="text-xs text-gray-500">{label}</div><div className="font-semibold text-sm">{value}</div></div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <FlaskConical className="h-6 w-6 text-blue-600" />
        <h1 className="text-2xl font-bold">Banc d'essai</h1>
        <span className="text-sm text-gray-500">— teste les modèles, la vitesse et le coût (sans impacter la prod)</span>
      </div>

      {/* Onglets client / marketing */}
      <div className="flex gap-1 border-b mb-4">
        {(['client', 'marketing'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'client' ? 'Chat client' : 'Chat marketing'}
          </button>
        ))}
      </div>

      {/* Barre de contrôle : modèle + métriques + reset */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={model} onChange={e => setModel(e.target.value)}
          className="rounded-md border-gray-300 shadow-sm text-sm focus:border-blue-500 focus:ring-blue-500">
          {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <Metric icon={<Coins className="h-4 w-4" />} label="Coût conversation" value={fmtUsd(totalCost)} />
        <Metric icon={<Layers className="h-4 w-4" />} label="Tokens cumulés" value={totalTokens.toLocaleString('fr-FR')} />
        <Metric icon={<Clock className="h-4 w-4" />} label="Latence moy." value={avgLatency ? `${avgLatency} ms` : '—'} />
        <button onClick={() => setMsgs(tab, () => [])} disabled={!msgs.length}
          className="ml-auto flex items-center gap-1 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-40">
          <Trash2 className="h-4 w-4" /> Effacer
        </button>
      </div>

      {/* Fil de conversation */}
      <div className="bg-white rounded-xl shadow-sm border min-h-[50vh] max-h-[60vh] overflow-y-auto p-4 space-y-4">
        {!msgs.length && (
          <div className="text-center text-gray-400 py-16">
            Onglet <b>{tab === 'client' ? 'Chat client' : 'Chat marketing'}</b> — pose une question pour tester <b>{priceOf(model).label}</b>.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2 ${m.role === 'user' ? 'bg-blue-600 text-white' : m.error ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-gray-100 text-gray-800'}`}>
              {m.role === 'assistant'
                ? <div className="prose prose-sm max-w-none break-words [&_a]:text-blue-600 [&_a]:underline">
                    <ReactMarkdown components={{ a: ({ ...p }) => <a {...p} target="_blank" rel="noreferrer" /> }}>{m.content}</ReactMarkdown>
                  </div>
                : <span className="whitespace-pre-wrap">{m.content}</span>}
              {m.role === 'assistant' && !m.error && (
                <div className="mt-2 pt-2 border-t border-gray-200 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
                  <span>{priceOf(m.model || '').label}</span>
                  <span>⏱ {m.latencyMs} ms</span>
                  <span>💰 {fmtUsd(m.costUsd || 0)}</span>
                  <span>↑{m.promptTokens} ↓{m.completionTokens} tk</span>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && <div className="flex justify-start"><div className="bg-gray-100 rounded-2xl px-4 py-2 text-gray-400 text-sm">{priceOf(model).label} rédige…</div></div>}
        <div ref={endRef} />
      </div>

      {/* Saisie */}
      <div className="flex gap-2 mt-3">
        <textarea value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={2} placeholder={`Message (${tab === 'client' ? 'vue client' : 'contenu marketing'})…`}
          className="flex-1 rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm resize-none" />
        <button onClick={send} disabled={loading || !input.trim()}
          className="px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 flex items-center">
          <Send className="h-5 w-5" />
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-2">Coûts estimés en USD (tarifs OpenRouter/Mistral). Le contexte RAG est ré-envoyé à chaque tour → les tokens d'entrée montent avec l'historique. Conversations sauvegardées localement (par navigateur), distinctes par onglet.</p>
    </div>
  );
}
