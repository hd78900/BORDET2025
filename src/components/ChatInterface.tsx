import React, { useState, useEffect } from 'react';
import { Send, MessageSquare, Save, ChevronLeft, ChevronRight, Trash2, Plus, Copy, Check } from 'lucide-react';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import ReactMarkdown from 'react-markdown';
import { getAdminChatResponse, loadChatHistory, loadCurrentChat, deleteConversation, saveCurrentConversation, startNewChat } from '../lib/api';
import { ChatMessage } from '../types';

// Modèles testables + tarif ($/M tokens), aligné avec l'allowlist du proxy mistral-proxy.
const MODELS = [
  { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', in: 0.25, out: 1.50 },
  { id: 'openai/gpt-5.4-nano', label: 'GPT-5.4 nano', in: 0.20, out: 1.25 },
  { id: 'mistral-medium-latest', label: 'Mistral medium', in: 1.50, out: 7.50 },
];
const priceOf = (id: string) => MODELS.find(m => m.id === id) ?? { id, label: id, in: 0, out: 0 };
const costUsd = (id: string, pt: number, ct: number) => (pt * priceOf(id).in + ct * priceOf(id).out) / 1e6;
const fmtUsd = (c: number) => '$' + (c < 0.01 ? c.toFixed(5) : c.toFixed(4));
type Metric = { model: string; latencyMs: number; pt: number; ct: number; cost: number };

export default function ChatInterface() {
  const [input, setInput] = useState('');
  const { messagesByBot, selectedBot, loading, setLoading, setMessages } = useChatStore();
  const { user } = useAuthStore();
  const [savedConversations, setSavedConversations] = useState<{ [key: string]: ChatMessage[] }>({});
  const [showSidebar, setShowSidebar] = useState(true);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'client' | 'marketing'>('client');
  const [model, setModel] = useState<string>(MODELS[0].id);
  const [metricsByTs, setMetricsByTs] = useState<Record<number, Metric>>({});

  // Clé de persistance distincte par onglet -> historiques/sauvegardes séparés (logique existante préservée).
  const botKey = activeTab === 'marketing' ? `${selectedBot}-marketing` : selectedBot;

  const loadMessages = async () => {
    if (!user) return;

    const messages = await loadCurrentChat(user.id, botKey);
    setMessages(botKey, messages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
      timestamp: new Date(msg.created_at).getTime()
    })));

    const history = await loadChatHistory(user.id, botKey);
    const conversations: { [key: string]: ChatMessage[] } = {};
    let currentConversation: ChatMessage[] = [];
    let lastTimestamp = 0;

    history.forEach(msg => {
      const timestamp = msg.conversation_timestamp || new Date(msg.created_at).getTime();
      if (currentConversation.length === 0 || timestamp === lastTimestamp) {
        currentConversation.push({ role: msg.role as 'user' | 'assistant', content: msg.content, timestamp });
        lastTimestamp = timestamp;
      } else {
        if (currentConversation.length > 0) {
          conversations[currentConversation[0].timestamp] = currentConversation;
        }
        currentConversation = [{ role: msg.role as 'user' | 'assistant', content: msg.content, timestamp }];
        lastTimestamp = timestamp;
      }
    });

    if (currentConversation.length > 0) {
      conversations[currentConversation[0].timestamp] = currentConversation;
    }

    setSavedConversations(conversations);
  };

  useEffect(() => {
    loadMessages();
  }, [user, botKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading || !user) return;

    const timestamp = Date.now();
    const userMessage: ChatMessage = { role: 'user', content: input, timestamp };
    const currentMessages = messagesByBot[botKey] || [];
    const text = input;
    setMessages(botKey, [...currentMessages, userMessage]);
    setInput('');
    setLoading(true);

    const r = await getAdminChatResponse(
      text, botKey, user.id, activeTab,
      currentMessages.slice(-6).map(m => ({ role: m.role, content: m.content })),
      model
    );

    const assistantMessage: ChatMessage = { role: 'assistant', content: r.content, timestamp };
    setMessages(botKey, [...currentMessages, userMessage, assistantMessage]);
    if (!r.error) {
      setMetricsByTs(prev => ({
        ...prev,
        [timestamp]: { model, latencyMs: r.latencyMs, pt: r.promptTokens, ct: r.completionTokens, cost: costUsd(model, r.promptTokens, r.completionTokens) }
      }));
    }
    setLoading(false);
  };

  const handleSaveConversation = async () => {
    if (!user || !messagesByBot[botKey]?.length) return;
    await saveCurrentConversation(user.id, botKey);
    await loadMessages();
    setMessages(botKey, []);
  };

  const handleDeleteConversation = async (timestamp: number) => {
    if (!user) return;
    await deleteConversation(user.id, botKey, timestamp);
    await loadMessages();
  };

  const handleNewChat = async () => {
    if (!user) return;
    await startNewChat(user.id, botKey);
    setMessages(botKey, []);
  };

  const handleLoadConversation = (timestamp: number) => {
    const conversation = savedConversations[timestamp];
    if (conversation) {
      setMessages(botKey, conversation);
    }
  };

  const handleCopyMessage = async (content: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  // Métriques cumulées de la conversation affichée (messages live uniquement).
  const curMsgs = messagesByBot[botKey] || [];
  const liveMetrics = curMsgs.map(m => metricsByTs[m.timestamp]).filter(Boolean) as Metric[];
  const totalCost = liveMetrics.reduce((s, x) => s + x.cost, 0);
  const avgLatency = liveMetrics.length ? Math.round(liveMetrics.reduce((s, x) => s + x.latencyMs, 0) / liveMetrics.length) : 0;

  // Composants personnalisés pour ReactMarkdown
  const components = {
    h1: ({ node, ...props }) => <h1 {...props} className="text-2xl font-bold mt-6 mb-4" />,
    h2: ({ node, ...props }) => <h2 {...props} className="text-xl font-bold mt-5 mb-3" />,
    h3: ({ node, ...props }) => <h3 {...props} className="text-lg font-bold mt-4 mb-2" />,
    p: ({ node, ...props }) => <p {...props} className="my-4 leading-relaxed" />,
    ul: ({ node, ...props }) => <ul {...props} className="my-4 ml-6 list-disc space-y-2" />,
    ol: ({ node, ...props }) => <ol {...props} className="my-4 ml-6 list-decimal space-y-2" />,
    li: ({ node, ...props }) => <li {...props} className="my-1" />,
    a: ({ node, ...props }) => {
      const href = props.href?.startsWith('http') ? props.href : `https://www.bordet.fr${props.href}`;
      return <a {...props} href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 font-medium" />;
    },
    strong: ({ node, ...props }) => <strong {...props} className="font-bold" />,
    em: ({ node, ...props }) => <em {...props} className="italic" />,
    code: ({ node, inline, ...props }) => (
      inline
        ? <code {...props} className="px-1.5 py-0.5 bg-gray-100 rounded text-sm" />
        : <code {...props} className="block bg-gray-100 p-4 rounded-lg my-4 text-sm overflow-x-auto" />
    ),
    hr: () => <hr className="my-6 border-t border-gray-200" />,
    blockquote: ({ node, ...props }) => <blockquote {...props} className="border-l-4 border-gray-200 pl-4 my-4 italic" />
  };

  return (
    <div className="flex h-[calc(100vh-16rem)]">
      {/* Sidebar */}
      <div className={`bg-white border-r ${showSidebar ? 'w-64' : 'w-0'} transition-all duration-300 overflow-hidden`}>
        <div className="p-4">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2 bg-red-950 text-white px-4 py-2 rounded-lg hover:bg-red-800"
          >
            <Plus className="h-4 w-4" />
            Nouvelle conversation
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(100vh-20rem)]">
          {Object.entries(savedConversations).map(([timestamp, messages]) => {
            const firstUserMessage = messages.find(msg => msg.role === 'user');
            if (!firstUserMessage) return null;

            return (
              <div
                key={timestamp}
                className="p-4 hover:bg-gray-50 cursor-pointer border-b flex items-center justify-between"
                onClick={() => handleLoadConversation(Number(timestamp))}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <MessageSquare className="h-4 w-4 text-gray-500 flex-shrink-0" />
                  <span className="text-sm truncate">{firstUserMessage.content}</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteConversation(Number(timestamp));
                  }}
                  className="text-gray-400 hover:text-red-950 ml-2 flex-shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Onglets (Assistant bordet.fr / Création de contenu marketing) + modèle + métriques */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-white">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('client')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'client' ? 'bg-red-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              Assistant bordet.fr
            </button>
            <button
              onClick={() => setActiveTab('marketing')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'marketing' ? 'bg-red-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              Création de contenu marketing
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 whitespace-nowrap" title="Coût cumulé et latence moyenne de la conversation">
              💰 {fmtUsd(totalCost)} · ⏱ {avgLatency ? `${avgLatency} ms` : '—'}
            </span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-md border-gray-300 shadow-sm text-sm focus:border-red-800 focus:ring-red-800"
              title="Modèle utilisé pour le test (n'affecte pas la production)"
            >
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {/* Toggle Sidebar Button */}
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="absolute top-24 left-4 z-10 p-2 bg-white rounded-full shadow-md hover:bg-gray-50"
        >
          {showSidebar ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-8">
          {(!messagesByBot[botKey] || messagesByBot[botKey].length === 0) && (
            <div className="text-center text-gray-500 mt-8">
              <p className="text-lg font-medium mb-4">
                {activeTab === 'client'
                  ? 'Cet assistant utilise exclusivement la base de connaissance du site bordet.fr'
                  : 'Génération de contenu marketing à partir de la base de connaissance bordet.fr'}
              </p>
              <p className="text-sm">Posez votre question pour commencer la conversation.</p>
            </div>
          )}
          {messagesByBot[botKey]?.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[80%] rounded-lg px-4 py-3 ${message.role === 'user' ? 'bg-red-950 text-white' : 'bg-gray-100'}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-grow">
                    <ReactMarkdown
                      components={components}
                      className={`${message.role === 'user' ? 'text-white' : 'text-gray-800'} space-y-2`}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                  {message.role === 'assistant' && (
                    <button
                      onClick={() => handleCopyMessage(message.content, `${index}`)}
                      className="ml-1 p-1 text-gray-500 hover:text-gray-700 rounded flex-shrink-0"
                      title="Copier le message"
                    >
                      {copiedMessageId === `${index}` ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </button>
                  )}
                </div>
                {/* Métriques sous la réponse (modèle · vitesse · coût · tokens) */}
                {message.role === 'assistant' && metricsByTs[message.timestamp] && (
                  <div className="mt-2 pt-2 border-t border-gray-200 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
                    <span>{priceOf(metricsByTs[message.timestamp].model).label}</span>
                    <span>⏱ {metricsByTs[message.timestamp].latencyMs} ms</span>
                    <span>💰 {fmtUsd(metricsByTs[message.timestamp].cost)}</span>
                    <span>↑{metricsByTs[message.timestamp].pt} ↓{metricsByTs[message.timestamp].ct} tk</span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-lg p-4">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="border-t p-4">
          <div className="flex items-center gap-4">
            {messagesByBot[botKey]?.length > 0 && (
              <button
                onClick={handleSaveConversation}
                className="p-2 text-gray-500 hover:text-red-950 hover:bg-blue-50 rounded-lg"
                title="Sauvegarder la conversation"
              >
                <Save className="h-5 w-5" />
              </button>
            )}
            <form onSubmit={handleSubmit} className="flex-1 flex gap-4">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={activeTab === 'client' ? 'Tapez votre message...' : 'Décrivez le contenu marketing à générer...'}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-950 focus:border-transparent"
              />
              <button
                type="submit"
                disabled={loading}
                className="bg-red-950 text-white p-3 rounded-lg hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="h-5 w-5" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
