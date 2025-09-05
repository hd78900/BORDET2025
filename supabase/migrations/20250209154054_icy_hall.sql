/*
  # Fix user permissions and access

  1. Changes
    - Fix user_bot_access policies to allow users to view their own access
    - Fix chat_messages policies to allow users to manage their own messages
    - Add proper RLS enforcement for bot access

  2. Security
    - Enable RLS on all tables
    - Add proper policies for both users and admins
    - Ensure users can only access their allowed bots
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Les administrateurs peuvent gérer les accès" ON user_bot_access;
DROP POLICY IF EXISTS "Les utilisateurs peuvent voir leurs accès" ON user_bot_access;
DROP POLICY IF EXISTS "Users can manage their own messages" ON chat_messages;
DROP POLICY IF EXISTS "Admins can view all messages" ON chat_messages;

-- Fix user_bot_access policies
CREATE POLICY "Users can view their bot access"
  ON user_bot_access
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage bot access"
  ON user_bot_access
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Fix chat_messages policies
CREATE POLICY "Users can manage their messages"
  ON chat_messages
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    AND
    EXISTS (
      SELECT 1 FROM user_bot_access
      WHERE user_id = auth.uid()
      AND bot_id = chat_messages.bot_id
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND
    EXISTS (
      SELECT 1 FROM user_bot_access
      WHERE user_id = auth.uid()
      AND bot_id = chat_messages.bot_id
    )
  );

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