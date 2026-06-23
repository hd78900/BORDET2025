import { useConfigStore } from '../store/configStore';
import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const MISTRAL_PROXY_URL = `${SUPABASE_URL}/functions/v1/mistral-proxy`;

interface DocumentMatch {
  id: number;
  content: string;
  metadata: {
    url?: string;
    title?: string;
    source?: string;
    [key: string]: any;
  };
  similarity: number;
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Authorization': `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
  };
}

async function mistralChat(messages: Array<{ role: string; content: string }>, temperature: number, mode: 'client' | 'marketing' = 'client'): Promise<string> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${MISTRAL_PROXY_URL}/chat`, {
    method: 'POST',
    headers,
    // model fourni en défaut pour rétro-compat avec l'ancien proxy ; le proxy durci l'ignore et choisit selon le mode
    body: JSON.stringify({ model: 'mistral-small-latest', messages, temperature, mode }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error?.message || err.error || `Mistral API error: ${res.status}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function mistralEmbeddings(input: string): Promise<number[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${MISTRAL_PROXY_URL}/embeddings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error?.message || err.error || `Embeddings API error: ${res.status}`);
  }

  const data = await res.json();
  if (!data?.data?.[0]?.embedding) {
    throw new Error('Failed to generate embeddings');
  }
  return data.data[0].embedding;
}

async function searchDocuments(botId: string, queryEmbedding: number[], matchCount: number = 20): Promise<DocumentMatch[]> {
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: matchCount,
    filter_bot_id: botId,
  });

  if (error) {
    throw new Error(`Vector search error: ${error.message}`);
  }

  return data || [];
}

function extractProductsFromContext(matches: DocumentMatch[]): Map<string, { name: string, url: string }> {
  const products = new Map<string, { name: string, url: string }>();
  for (const match of matches) {
    const metadata = match.metadata;
    if (metadata?.url && metadata.url.startsWith('https://www.bordet.fr/') && metadata.title) {
      const name = metadata.title;
      const normalizedName = name.toLowerCase().replace(/[^\w\s]/g, '');
      products.set(normalizedName, { name, url: metadata.url });
      products.set(
        normalizedName.replace(/poele|poêle|insert|cheminée|foyer/g, '').trim(),
        { name, url: metadata.url }
      );
    }
  }
  return products;
}

function enforceProductUrls(response: string, products: Map<string, { name: string, url: string }>): string {
  let modifiedResponse = response;
  modifiedResponse = modifiedResponse.replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, (match, text) => {
    const normalizedText = text.toLowerCase().replace(/[^\w\s]/g, '');
    for (const [key, value] of products.entries()) {
      if (normalizedText.includes(key)) {
        return `[**${value.name}**](${value.url})`;
      }
    }
    return text;
  });
  const productPatterns = [
    /\*\*([\w\s-]+(?:poêle|poele|insert|cheminée|foyer)[\w\s-]*)\*\*/gi,
    /(?:^|\s)((?:poêle|poele|insert|cheminée|foyer)\s+(?:à\s+(?:bois|granulés|pellets|gaz))?\s+[\w\s-]+)(?:\s|$)/gi
  ];
  for (const pattern of productPatterns) {
    modifiedResponse = modifiedResponse.replace(pattern, (match, productName) => {
      const normalizedName = productName.toLowerCase().replace(/[^\w\s]/g, '');
      for (const [key, value] of products.entries()) {
        if (normalizedName.includes(key) || key.includes(normalizedName)) {
          return ` [**${value.name}**](${value.url}) `;
        }
      }
      return match;
    });
  }
  return modifiedResponse;
}

const normUrlText = (s: string) =>
  s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Garantie 100% : toute URL affichée doit provenir d'un chunk réellement récupéré.
// Sinon elle est réécrite via le nom du produit/article, sinon l'URL est supprimée.
function sanitizeUrls(response: string, matches: DocumentMatch[]): string {
  const valid = new Set<string>();
  const nameToUrl = new Map<string, string>();
  for (const m of matches) {
    const url = m.metadata?.url;
    const title = m.metadata?.title;
    if (url && url.startsWith('https://www.bordet.fr/')) {
      valid.add(url);
      if (title) nameToUrl.set(normUrlText(title), url);
    }
  }
  let out = response.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (full, text, url) => {
    if (valid.has(url)) return full;
    const nt = normUrlText(text);
    for (const [name, u] of nameToUrl) {
      if (name && (nt === name || nt.includes(name) || name.includes(nt))) {
        return `[${text}](${u})`;
      }
    }
    return text; // lien fabriqué -> on garde le libellé, on retire l'URL
  });
  out = out.replace(/(?<![(\]])https?:\/\/[^\s)]+/g, (url) => (valid.has(url) ? url : ''));
  return out;
}

async function getConversationContext(userId: string, botId: string, currentTimestamp: number): Promise<string> {
  try {
    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('user_id', userId)
      .eq('bot_id', botId)
      .eq('conversation_timestamp', currentTimestamp)
      .order('created_at', { ascending: true });
    if (error || !messages || messages.length === 0) return '';
    return messages.map(msg => `${msg.role}: ${msg.content}`).join('\n\n');
  } catch (error) {
    console.error('Error in getConversationContext:', error);
    return '';
  }
}

export async function getChatResponse(message: string, botId: string, userId?: string, currentBotId?: string, chatMode: 'client' | 'marketing' = 'client') {
  let conversationTimestamp = Date.now();
  let response: string;
  let products: Map<string, { name: string, url: string }> | undefined;
  const activeBotId = currentBotId || botId;

  try {
    const { temperature, systemPrompt, marketingPrompt, contextRules } = useConfigStore.getState();

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

    {
      const embedding = await mistralEmbeddings(message);

      const matches = await searchDocuments(botId, embedding, 20);

      if (!matches || matches.length === 0) {
        throw new Error('No matches found in vector database');
      }

      products = extractProductsFromContext(matches);

      const vectorContext = matches
        .map(match => match.content)
        .filter(Boolean)
        .join('\n\n');

      let conversationContext = '';
      if (userId && activeBotId) {
        conversationContext = await getConversationContext(userId, activeBotId, conversationTimestamp);
      }

      const botSpecificRules = contextRules[activeBotId || ''] || '';
      const fullSystemPrompt = chatMode === 'marketing'
        ? `${marketingPrompt}\n\nHistorique de la conversation:\n${conversationContext}\n\nContexte de la base de connaissances:\n${vectorContext}`
        : `${systemPrompt}\n\n${botSpecificRules}\n\nHistorique de la conversation:\n${conversationContext}\n\nContexte de la base de connaissances:\n${vectorContext}`;

      response = await mistralChat([
        { role: "system", content: fullSystemPrompt },
        { role: "user", content: message }
      ], temperature, chatMode);

      if (activeBotId === 'bot1' && products) {
        response = enforceProductUrls(response, products);
      }

      // Garantie 100% : aucune URL hors des chunks récupérés ne survit
      response = sanitizeUrls(response, matches);
    }

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
