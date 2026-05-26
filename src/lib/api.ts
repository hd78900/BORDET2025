import { Pinecone } from '@pinecone-database/pinecone';
import { useConfigStore } from '../store/configStore';
import { supabase } from './supabase';
import { chatbots } from '../config/chatbots';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const MISTRAL_PROXY_URL = `${SUPABASE_URL}/functions/v1/mistral-proxy`;

const pc = new Pinecone({
  apiKey: import.meta.env.VITE_PINECONE_API_KEY
});

interface PineconeMetadata {
  text: string;
  url?: string;
  title?: string;
  source?: string;
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Authorization': `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
  };
}

async function mistralChat(model: string, messages: Array<{ role: string; content: string }>, temperature: number): Promise<string> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${MISTRAL_PROXY_URL}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, temperature }),
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

function extractProductsFromContext(matches: Array<{ metadata?: PineconeMetadata }>): Map<string, { name: string, url: string }> {
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

export async function getChatResponse(message: string, indexName: string, userId?: string, botId?: string) {
  let conversationTimestamp = Date.now();
  let response: string;
  let products: Map<string, { name: string, url: string }> | undefined;

  try {
    const { model, testMode, temperature, systemPrompt, contextRules } = useConfigStore.getState();

    if (userId && botId) {
      try {
        const { data: lastMessage } = await supabase
          .from('chat_messages')
          .select('conversation_timestamp')
          .eq('user_id', userId)
          .eq('bot_id', botId)
          .eq('is_saved', false)
          .order('created_at', { ascending: false })
          .limit(1);

        if (lastMessage && lastMessage.length > 0) {
          conversationTimestamp = lastMessage[0].conversation_timestamp;
        }

        await supabase.from('chat_messages').insert({
          user_id: userId,
          bot_id: botId,
          role: 'user',
          content: message,
          is_saved: false,
          conversation_timestamp: conversationTimestamp
        });
      } catch (error) {
        console.error('Error saving user message:', error);
      }
    }

    if (testMode) {
      response = await mistralChat(model, [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ], temperature);
    } else {
      const index = pc.index(indexName);

      const embedding = await mistralEmbeddings(message);

      const queryResponse = await index.query({
        vector: embedding,
        topK: 20,
        includeMetadata: true
      });

      if (!queryResponse?.matches) {
        throw new Error('No matches found in vector database');
      }

      products = extractProductsFromContext(queryResponse.matches);

      const vectorContext = queryResponse.matches
        .map(match => match.metadata?.text)
        .filter(Boolean)
        .join('\n\n');

      let conversationContext = '';
      if (userId && botId) {
        conversationContext = await getConversationContext(userId, botId, conversationTimestamp);
      }

      const botSpecificRules = contextRules[botId || ''] || '';
      const fullSystemPrompt = `${systemPrompt}\n\n${botSpecificRules}\n\nHistorique de la conversation:\n${conversationContext}\n\nContexte de la base de connaissances:\n${vectorContext}`;

      response = await mistralChat(model, [
        { role: "system", content: fullSystemPrompt },
        { role: "user", content: message }
      ], temperature);

      if (botId === 'bot1' && products) {
        response = enforceProductUrls(response, products);
      }
    }

    if (userId && botId) {
      try {
        await supabase.from('chat_messages').insert({
          user_id: userId,
          bot_id: botId,
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

export async function checkPineconeStatus(indexName: string) {
  try {
    const index = pc.index(indexName);
    const stats = await index.describeIndexStats();

    return {
      status: 'ready',
      vectorCount: stats.totalVectorCount,
      dimension: stats.dimension
    };
  } catch (error) {
    console.error('Error checking Pinecone status:', error);
    return {
      status: 'error',
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
