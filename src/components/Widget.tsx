import React, { useState } from 'react';
import { Send, X, Minimize2, Maximize2, Copy, Check, EyeOff } from 'lucide-react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { getChatResponse } from '../lib/api';
import { ChatMessage } from '../types';
import { chatbots } from '../config/chatbots';
import { useConfigStore } from '../store/configStore';

export default function Widget() {
  const { widgetEnabled } = useConfigStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showWelcomeBubble, setShowWelcomeBubble] = useState(false);
  const { botId } = useParams();

  const currentBot = chatbots.find(bot => bot.id === botId);

  if (!currentBot) return null;

  // Vérifier si le widget est activé depuis le store
  if (!widgetEnabled) {
    return (
      <div className="fixed bottom-4 right-4 p-4 bg-red-100 border border-red-300 rounded-lg text-red-800 text-sm max-w-xs">
        Widget désactivé depuis le tableau de bord
      </div>
    );
  }

  // Si le widget est masqué, ne rien afficher
  if (isHidden) return null;

  // Fonction pour notifier le parent du changement de taille
  const notifyResize = (width: number, height: number) => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'WIDGET_RESIZE',
        width,
        height
      }, '*');
    }
  };

  // Notifier la taille quand l'état change
  React.useEffect(() => {
    if (!isOpen) {
      notifyResize(280, 270); // Taille du bouton Raymond avec marge
    } else if (isMinimized) {
      notifyResize(350, 80); // Taille minimisée
    } else {
      notifyResize(450, 650); // Taille complète avec plus de marge
    }
  }, [isOpen, isMinimized]);

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
      const response = await getChatResponse(input, currentBot.pineconeIndex);
      
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
      const newIsOpen = !isOpen;
      setIsOpen(newIsOpen);
      if (newIsOpen && messages.length === 0) {
        setShowWelcomeBubble(true);
        setTimeout(() => setShowWelcomeBubble(false), 8000);
      }
    }
  };

  const toggleMinimize = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMinimized(!isMinimized);
  };

  const handleHideWidget = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsHidden(true);
    // Notifier le parent que le widget est masqué
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'WIDGET_HIDDEN'
      }, '*');
    }
  };

  const handleDirectHide = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsHidden(true);
    // Notifier le parent que le widget est masqué
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'WIDGET_HIDDEN'
      }, '*');
    }
  };

  // Composants personnalisés pour ReactMarkdown
  const components = {
    h1: ({ node, ...props }) => <h1 {...props} className="text-xl font-bold mt-4 mb-3" />,
    h2: ({ node, ...props }) => <h2 {...props} className="text-lg font-bold mt-3 mb-2" />,
    h3: ({ node, ...props }) => <h3 {...props} className="text-base font-bold mt-2 mb-1" />,
    p: ({ node, ...props }) => <p {...props} className="my-2 leading-relaxed" />,
    ul: ({ node, ...props }) => <ul {...props} className="my-2 ml-4 list-disc space-y-1" />,
    ol: ({ node, ...props }) => <ol {...props} className="my-2 ml-4 list-decimal space-y-1" />,
    li: ({ node, ...props }) => <li {...props} className="my-0.5" />,
    a: ({ node, ...props }) => {
      const href = props.href?.startsWith('http') ? props.href : `https://www.bordet.fr${props.href}`;
      return (
        <a
          {...props}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 font-medium"
        />
      );
    },
    strong: ({ node, ...props }) => <strong {...props} className="font-bold" />,
    em: ({ node, ...props }) => <em {...props} className="italic" />,
    code: ({ node, inline, ...props }) => (
      inline ? (
        <code {...props} className="px-1 py-0.5 bg-gray-100 rounded text-sm" />
      ) : (
        <code {...props} className="block bg-gray-100 p-2 rounded my-2 text-sm overflow-x-auto" />
      )
    ),
    hr: () => <hr className="my-4 border-t border-gray-200" />,
    blockquote: ({ node, ...props }) => (
      <blockquote {...props} className="border-l-2 border-gray-200 pl-2 my-2 italic" />
    )
  };

  return (
    <div className="w-full h-full" style={{ pointerEvents: 'auto' }}>
      {!isOpen ? (
        <div className="fixed bottom-4 right-4 group" style={{ pointerEvents: 'auto' }}>
          {/* Bouton de masquage direct */}
          <button
            onClick={handleDirectHide}
            className="absolute top-2 right-2 bg-black bg-opacity-70 text-white p-2 rounded-full hover:bg-opacity-90 z-10"
            title="Masquer l'assistant"
          >
            <EyeOff className="h-5 w-5" />
          </button>
          <button
            onClick={toggleWidget}
            className="hover:opacity-90 transition-opacity duration-300 block relative"
            style={{
              width: '260px',
              height: '248px',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              pointerEvents: 'auto'
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
          className={`fixed bottom-4 right-4 bg-white rounded-lg shadow-xl transition-all duration-300 ${
            isMinimized ? 'w-auto h-auto' : 'w-[420px] h-[620px]'
          }`}
          style={{
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '14px',
            lineHeight: '1.5',
            pointerEvents: 'auto'
          }}
        >
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-3">
              <img 
                src="https://i.postimg.cc/mg6hR2HV/raymond-portrait.png" 
                alt="Assistant Icon" 
                className="w-12 h-12 rounded-full object-cover shadow-md"
              />
              <h3 className="font-semibold text-base">{currentBot.name}</h3>
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
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {showWelcomeBubble && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <div className="flex items-start gap-3">
                      <img 
                        src="https://i.postimg.cc/mg6hR2HV/raymond-portrait.png" 
                        alt="Assistant" 
                        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                      />
                      <div className="flex-1">
                        <p className="text-blue-800 text-sm leading-relaxed">
                          Je suis votre assistant technique personnel, prêt à vous accompagner dans vos projets. Que vous soyez débutant ou expert, tournage, sculpture, ébénisterie ou menuiserie, je vous aide à trouver les bons outils.
                        </p>
                        <div className="mt-3 text-blue-800 text-sm">
                          <p className="font-medium mb-2">Dites-moi simplement :</p>
                          <ul className="space-y-1 ml-2">
                            <li>• Sur quel projet travaillez-vous ?</li>
                            <li>• Quel outil recherchez-vous ?</li>
                            <li>• Quelle technique souhaitez-vous maîtriser ?</li>
                          </ul>
                        </div>
                      </div>
                      <button
                        onClick={() => setShowWelcomeBubble(false)}
                        className="text-blue-600 hover:text-blue-800 flex-shrink-0"
                        title="Fermer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
                {messages.length === 0 && (
                  <div className="text-center text-gray-500 mt-8">
                    <p className="text-base font-medium mb-4">Comment puis-je vous aider ?</p>
                    <p className="text-sm">Posez votre question pour commencer la conversation.</p>
                  </div>
                )}
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 ${
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
                            } space-y-1`}
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
                    <div className="bg-gray-100 rounded-lg p-3">
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
                <form onSubmit={handleSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Tapez votre message..."
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-950 focus:border-transparent"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-red-950 text-white p-2 rounded-lg hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="h-4 w-4" />
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