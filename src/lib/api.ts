import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const MISTRAL_PROXY_URL = `${SUPABASE_URL}/functions/v1/mistral-proxy`;

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Authorization': `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
  };
}

async function chatViaProxy(message: string, mode: 'client' | 'marketing', history: Array<{ role: string; content: string }>): Promise<string> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${MISTRAL_PROXY_URL}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, mode, history }),
  });

  if (res.status === 503) {
    const e = await res.json().catch(() => ({} as any));
    return e.error || "Le service est très sollicité en ce moment, merci de réessayer dans un instant.";
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error?.message || err.error || `Mistral API error: ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ---- Banc d'essai (admin) : choisit le modèle par requête + renvoie vitesse + tokens pour le coût ----
export type PlaygroundResult = {
  content: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  error?: boolean;
};

export async function playgroundChat(
  message: string,
  mode: 'client' | 'marketing',
  history: Array<{ role: string; content: string }>,
  model: string
): Promise<PlaygroundResult> {
  const headers = await getAuthHeaders();
  const t0 = performance.now();
  const res = await fetch(`${MISTRAL_PROXY_URL}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, mode, history, model }),
  });
  const latencyMs = Math.round(performance.now() - t0);
  const empty = { model, latencyMs, promptTokens: 0, completionTokens: 0, error: true };
  if (res.status === 503) {
    const e = await res.json().catch(() => ({} as any));
    return { ...empty, content: e.error || 'Service très sollicité, réessayez dans un instant.' };
  }
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok || !data?.choices?.[0]?.message) {
    return { ...empty, content: data?.error?.message || data?.error || `Erreur ${res.status}` };
  }
  return {
    content: data.choices[0].message.content ?? '',
    model: data.model ?? model,
    latencyMs,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
}

export async function getChatResponse(message: string, botId: string, userId?: string, currentBotId?: string, chatMode: 'client' | 'marketing' = 'client', history: Array<{ role: string; content: string }> = []) {
  let conversationTimestamp = Date.now();
  let response: string;
  const activeBotId = currentBotId || botId;

  try {

    if (userId && activeBotId) {
      try {
        const { data: lastMessage } = await supabase
          .from('chat_messages')
          .select('conversation_timestamp')
          .eq('user_id', userId)
          .eq('bot_id', activeBotId)
          .eq('is_saved', false)
          .order('created_at', { ascending: false })
          .limit(1);

        if (lastMessage && lastMessage.length > 0) {
          conversationTimestamp = lastMessage[0].conversation_timestamp;
        }

        await supabase.from('chat_messages').insert({
          user_id: userId,
          bot_id: activeBotId,
          role: 'user',
          content: message,
          is_saved: false,
          conversation_timestamp: conversationTimestamp
        });
      } catch (error) {
        console.error('Error saving user message:', error);
      }
    }

    response = await chatViaProxy(message, chatMode, history);

    if (userId && activeBotId) {
      try {
        await supabase.from('chat_messages').insert({
          user_id: userId,
          bot_id: activeBotId,
          role: 'assistant',
          content: response,
          is_saved: false,
          conversation_timestamp: conversationTimestamp
        });
      } catch (error) {
        console.error('Error saving assistant response:', error);
      }
    }

    return response;
  } catch (error: any) {
    console.error('Error in getChatResponse:', error);
    throw new Error(error.message || 'An error occurred while processing your request. Please try again.');
  }
}

export async function loadChatHistory(userId: string, botId: string) {
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', userId)
      .eq('bot_id', botId)
      .eq('is_saved', true)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error loading chat history:', error);
    throw error;
  }
}

export async function loadCurrentChat(userId: string, botId: string) {
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('user_id', userId)
      .eq('bot_id', botId)
      .eq('is_saved', false)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error loading current chat:', error);
    throw error;
  }
}

export async function saveCurrentConversation(userId: string, botId: string) {
  try {
    const timestamp = Date.now();
    const { error } = await supabase
      .from('chat_messages')
      .update({
        is_saved: true,
        conversation_timestamp: timestamp
      })
      .eq('user_id', userId)
      .eq('bot_id', botId)
      .eq('is_saved', false);
    if (error) throw error;
  } catch (error) {
    console.error('Error saving conversation:', error);
    throw error;
  }
}

export async function deleteConversation(userId: string, botId: string, timestamp: number) {
  try {
    const { error } = await supabase
      .from('chat_messages')
      .delete()
      .eq('user_id', userId)
      .eq('bot_id', botId)
      .eq('conversation_timestamp', timestamp);
    if (error) throw error;
  } catch (error) {
    console.error('Error deleting conversation:', error);
    throw error;
  }
}

export async function startNewChat(userId: string, botId: string) {
  try {
    const { error } = await supabase
      .from('chat_messages')
      .delete()
      .eq('user_id', userId)
      .eq('bot_id', botId)
      .eq('is_saved', false);
    if (error) throw error;
  } catch (error) {
    console.error('Error starting new chat:', error);
    throw error;
  }
}

export async function checkVectorDbStatus(botId: string) {
  try {
    const { count, error } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('bot_id', botId);

    if (error) throw error;

    return {
      status: 'ready' as const,
      vectorCount: count || 0,
      dimension: 1024
    };
  } catch (error) {
    console.error('Error checking vector DB status:', error);
    return {
      status: 'error' as const,
      error: error instanceof Error ? error.message : 'Unknown error',
      vectorCount: 0,
      dimension: 0
    };
  }
}

export async function checkMistralStatus() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${MISTRAL_PROXY_URL}/models`, { headers });
    if (!res.ok) throw new Error(`Status: ${res.status}`);
    return { status: 'operational' };
  } catch (error) {
    console.error('Error checking Mistral status:', error);
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
