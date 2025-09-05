/*
  # Add chat messages table

  1. New Tables
    - `chat_messages`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references user_profiles)
      - `bot_id` (text)
      - `role` (text, check constraint for 'user' or 'assistant')
      - `content` (text)
      - `is_saved` (boolean)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `chat_messages` table
    - Add policies for users to manage their own messages
    - Add policies for admins to view all messages
*/

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) NOT NULL,
  bot_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  is_saved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Politique pour les utilisateurs : peuvent voir et gérer leurs propres messages
CREATE POLICY "Users can manage their own messages"
  ON chat_messages
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- Politique pour les admins : peuvent voir tous les messages
CREATE POLICY "Admins can view all messages"
  ON chat_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );