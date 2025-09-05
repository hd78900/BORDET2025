import { create } from 'zustand';
import { ChatState, ChatMessage } from '../types';

export const useChatStore = create<ChatState>((set, get) => ({
  messagesByBot: {},
  selectedBot: 'bot1',
  loading: false,

  setSelectedBot: (botId: string) => {
    console.log("🟡 Changement du bot sélectionné :", botId);
    set({ selectedBot: botId });
  },

  setMessages: (botId: string, messages: ChatMessage[]) => {
    console.log(`🟡 Ajout de messages pour ${botId}:`, messages);
    set((state) => ({
      messagesByBot: {
        ...state.messagesByBot,
        [botId]: messages,
      },
    }));
  },

  setLoading: (loading: boolean) => set({ loading }),

  clearMessages: (botId?: string) => {
    console.log(`🟡 Suppression des messages pour ${botId || "tous les bots"}`);
    set((state) => ({
      messagesByBot: botId
        ? {
            ...state.messagesByBot,
            [botId]: [],
          }
        : {},
    }));
  },
}));