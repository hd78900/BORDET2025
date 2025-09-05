/*
  # Add chat history table

  1. New Tables
    - `chat_history`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to user_profiles)
      - `bot_id` (text, references the chatbot)
      - `role` (text, either 'user' or 'assistant')
      - `content` (text, the message content)
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on `chat_history` table
    - Add policies for users to manage their own chat history
    - Add policies for admins to view all chat history
*/

CREATE TABLE IF NOT EXISTS chat_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) NOT NULL,
  bot_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;

-- Politique pour les utilisateurs : peuvent voir et gérer leur propre historique
CREATE POLICY "Users can manage their own chat history"
  ON chat_history
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid());

-- Politique pour les admins : peuvent voir tout l'historique
CREATE POLICY "Admins can view all chat history"
  ON chat_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );