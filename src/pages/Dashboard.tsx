import React from 'react';
import { useChatStore } from '../store/chatStore';
import { chatbots } from '../config/chatbots';
import ChatInterface from '../components/ChatInterface';

export default function Dashboard() {
  const { selectedBot, setSelectedBot } = useChatStore();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Barre d'onglets */}
      <div className="bg-white border-b">
        <div className="max-w-screen-2xl mx-auto px-4">
          <div className="flex overflow-x-auto no-scrollbar">
            {chatbots.map((bot) => {
              const Icon = bot.icon;
              return (
                <button
                  key={bot.id}
                  onClick={() => setSelectedBot(bot.id)}
                  className={`flex items-center gap-2 px-6 py-4 border-b-2 transition-colors whitespace-nowrap ${
                    selectedBot === bot.id
                      ? 'border-red-800 text-red-800'
                      : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="font-medium">{bot.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Zone de chat */}
      <div className="flex-1 bg-gray-50">
        <div className="max-w-screen-2xl mx-auto px-4 py-6">
          <ChatInterface />
        </div>
      </div>
    </div>
  );
}