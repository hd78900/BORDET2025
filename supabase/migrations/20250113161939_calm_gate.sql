/*
  # Add conversation timestamp column
  
  1. Changes
    - Add `conversation_timestamp` column to `chat_messages` table
    - This column will be used to group messages that belong to the same conversation
    - Default value is set to current timestamp
*/

ALTER TABLE chat_messages 
ADD COLUMN IF NOT EXISTS conversation_timestamp bigint;

-- Set default value for existing rows
UPDATE chat_messages 
SET conversation_timestamp = EXTRACT(EPOCH FROM created_at) * 1000
WHERE conversation_timestamp IS NULL;

-- Make the column NOT NULL after setting defaults
ALTER TABLE chat_messages 
ALTER COLUMN conversation_timestamp SET NOT NULL;