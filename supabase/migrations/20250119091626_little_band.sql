/*
  # Add memory settings to chat system

  1. New Columns
    - `context_window`: Number of previous messages to keep in memory
    - `memory_type`: Type of memory management ('conversation', 'summary', 'combined')
    - Added indexes for performance optimization
  
  2. Changes
    - Added memory-related columns to chat_messages table
    - Created indexes for faster context retrieval
*/

ALTER TABLE chat_messages
ADD COLUMN IF NOT EXISTS context_window integer DEFAULT 10,
ADD COLUMN IF NOT EXISTS memory_type text DEFAULT 'conversation'
  CHECK (memory_type IN ('conversation', 'summary', 'combined'));

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_context 
ON chat_messages(user_id, bot_id, conversation_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_memory 
ON chat_messages(memory_type, conversation_timestamp DESC);