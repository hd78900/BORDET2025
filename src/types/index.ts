export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatBot {
  id: string;
  name: string;
  description: string;
  icon: any;
}

export interface VectorDbStats {
  botId: string;
  vectorCount: number;
  status: 'ready' | 'error';
}

export interface ChatState {
  messagesByBot: Record<string, ChatMessage[]>;
  selectedBot: string;
  loading: boolean;
  setSelectedBot: (botId: string) => void;
  setMessages: (botId: string, messages: ChatMessage[]) => void;
  setLoading: (loading: boolean) => void;
  clearMessages: (botId?: string) => void;
}

export type MistralModel = 'mistral-small-latest' | 'mistral-medium-latest' | 'mistral-large-latest' | 'open-mistral-nemo';

export interface ConfigState {
  model: MistralModel;
  testMode: boolean;
  widgetTitle: string;
  widgetWelcomeMessage: string;
  temperature: number;
  systemPrompt: string;
  marketingPrompt: string;
  responseFormat: string;
  contextRules: Record<string, string>;
  setModel: (model: MistralModel) => void;
  setTestMode: (testMode: boolean) => void;
  setWidgetTitle: (title: string) => void;
  setWidgetWelcomeMessage: (message: string) => void;
  setTemperature: (temperature: number) => void;
  setSystemPrompt: (prompt: string) => void;
  setMarketingPrompt: (prompt: string) => void;
  setResponseFormat: (format: string) => void;
  setContextRules: (botId: string, rules: string) => void;
}

export interface AuthState {
  user: User | null;
  isAdmin: boolean;
  accessibleBots: string[];
  setUser: (user: User | null) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  setAccessibleBots: (bots: string[]) => void;
}

export interface User {
  id: string;
  email: string;
  is_admin: boolean;
}

export interface UserProfile extends User {
  created_at: string;
}