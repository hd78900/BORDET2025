import React, { useState } from 'react';
import { Send, X, Minimize2, Maximize2, Copy, Check, EyeOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { getChatResponse } from '../lib/api';
import { ChatMessage } from '../types';
import { useConfigStore } from '../store/configStore';

export default function PublicWidget() {
  const { 
    widgetEnabled, 
    widgetTitle, 
    widgetWelcomeMessage,
    model,
    temperature,
    systemPrompt,
    contextRules
  } = useConfigStore();

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  if (!widgetEnabled) return null;
  
  // Si le widget est masqué, ne rien afficher
  if (isHidden) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const timestamp = Date.now();
    const userMessage: ChatMessage = {
      role: 'user',
      content: input,
      timestamp
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await getChatResponse(input, 'bordet-siteweb');
      
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response,
        timestamp
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error:', error);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: "Désolé, une erreur s'est produite. Veuillez réessayer.",
        timestamp
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
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

  const toggleWidget = () => {
    if (isMinimized) {
      setIsMinimized(false);
    } else {
      setIsOpen(!isOpen);
    }
  };

  const toggleMinimize = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMinimized(!isMinimized);
  };

  const handleHideWidget = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsHidden(true);
  };

  const handleDirectHide = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsHidden(true);
  };

  // Composants personnalisés pour ReactMarkdown
  const components = {
    // Titres
    h1: ({ node, ...props }) => (
      <h1 {...props} className="text-2xl font-bold mt-6 mb-4" />
    ),
    h2: ({ node, ...props }) => (
      <h2 {...props} className="text-xl font-bold mt-5 mb-3" />
    ),
    h3: ({ node, ...props }) => (
      <h3 {...props} className="text-lg font-bold mt-4 mb-2" />
    ),
    // Paragraphes
    p: ({ node, ...props }) => (
      <p {...props} className="my-4 leading-relaxed" />
    ),
    // Listes
    ul: ({ node, ...props }) => (
      <ul {...props} className="my-4 ml-6 list-disc space-y-2" />
    ),
    ol: ({ node, ...props }) => (
      <ol {...props} className="my-4 ml-6 list-decimal space-y-2" />
    ),
    li: ({ node, ...props }) => (
      <li {...props} className="my-1" />
    ),
    // Liens
    a: ({ node, ...props }) => (
      <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800" />
    ),
    // Éléments de texte
    strong: ({ node, ...props }) => (
      <strong {...props} className="font-bold" />
    ),
    em: ({ node, ...props }) => (
      <em {...props} className="italic" />
    ),
    code: ({ node, inline, ...props }) => (
      inline ? (
        <code {...props} className="px-1.5 py-0.5 bg-gray-100 rounded text-sm" />
      ) : (
        <code {...props} className="block bg-gray-100 p-4 rounded-lg my-4 text-sm overflow-x-auto" />
      )
    ),
    // Séparateurs
    hr: () => <hr className="my-6 border-t border-gray-200" />,
    // Blocs de citation
    blockquote: ({ node, ...props }) => (
      <blockquote {...props} className="border-l-4 border-gray-200 pl-4 my-4 italic" />
    )
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isOpen ? (
        <div className="group relative">
          {/* Bouton de masquage direct */}
          <button
            onClick={handleDirectHide}
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black bg-opacity-70 text-white p-2 rounded-full hover:bg-opacity-90 z-10"
            title="Masquer l'assistant"
          >
            <EyeOff className="h-5 w-5" />
          </button>
          <button
            onClick={toggleWidget}
            className="hover:opacity-90 transition-opacity duration-300"
            style={{
              width: '259px',
              height: '247px',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer'
            }}
          >
            <img 
              src="https://i.postimg.cc/Y050gXtV/Raymond-bouton.png"
              alt="Assistant Bordet"
              className="w-full h-full object-contain"
              style={{
                filter: 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1))'
              }}
            />
          </button>
        </div>
      ) : (
        <div
          className={`bg-white rounded-lg shadow-xl transition-all duration-300 ${
            isMinimized ? 'w-auto h-auto' : 'w-[400px] h-[600px]'
          }`}
        >
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-3">
              <img 
                src="https://i.postimg.cc/mg6hR2HV/raymond-portrait.png" 
                alt="Assistant Icon" 
                className="w-16 h-16 rounded-full object-cover shadow-md"
              />
              <h3 className="font-semibold text-lg">{widgetTitle}</h3>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={toggleMinimize}
                className="p-1 hover:bg-gray-100 rounded"
                title={isMinimized ? "Agrandir" : "Réduire"}
              >
                {isMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
              </button>
              <button
                onClick={handleHideWidget}
                className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700"
                title="Masquer l'assistant"
              >
                <EyeOff className="h-5 w-5" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-100 rounded"
                title="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {!isMinimized && (
            <div className="flex flex-col h-[calc(100%-72px)]">
              <div className="flex-1 overflow-y-auto p-4 space-y-8">
                {messages.length === 0 && (
                  <div className="text-center text-gray-500 mt-8">
                    <p className="text-lg font-medium mb-4">{widgetWelcomeMessage}</p>
                    <p className="text-sm">Posez votre question pour commencer la conversation.</p>
                  </div>
                )}
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-3 ${
                        message.role === 'user'
                          ? 'bg-red-950 text-white'
                          : 'bg-gray-100'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-grow">
                          <ReactMarkdown 
                            components={components}
                            className={`${
                              message.role === 'user' 
                                ? 'text-white' 
                                : 'text-gray-800'
                            } space-y-2`}
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
                            {copiedMessageId === `${index}` ? (
                              <Check className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </div>
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
              <div className="border-t p-4">
                <form onSubmit={handleSubmit} className="flex gap-4">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Tapez votre message..."
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
          )}
        </div>
      )}
    </div>
  );
}