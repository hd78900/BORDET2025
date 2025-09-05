/*
  # Fix bot access permissions

  1. Changes
    - Add missing policies for user_bot_access
    - Ensure users can only access their allowed bots
    - Fix chat_messages access control

  2. Security
    - Proper RLS enforcement for bot access
    - Secure message management
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their bot access" ON user_bot_access;
DROP POLICY IF EXISTS "Admins can manage bot access" ON user_bot_access;
DROP POLICY IF EXISTS "Users can manage their messages" ON chat_messages;
DROP POLICY IF EXISTS "Admins can view all messages" ON chat_messages;

-- Fix user_bot_access policies
CREATE POLICY "Users can view and use their bot access"
  ON user_bot_access
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR 
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE POLICY "Admins can manage all bot access"
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
CREATE POLICY "Users can manage their own messages"
  ON chat_messages
  FOR ALL
  TO authenticated
  USING (
    -- User owns the message AND has access to the bot
    user_id = auth.uid()
    AND
    (
      EXISTS (
        SELECT 1 FROM user_bot_access
        WHERE user_id = auth.uid()
        AND bot_id = chat_messages.bot_id
      )
      OR
      EXISTS (
        SELECT 1 FROM user_profiles
        WHERE id = auth.uid() AND is_admin = true
      )
    )
  )
  WITH CHECK (
    -- Same conditions for inserts/updates
    user_id = auth.uid()
    AND
    (
      EXISTS (
        SELECT 1 FROM user_bot_access
        WHERE user_id = auth.uid()
        AND bot_id = chat_messages.bot_id
      )
      OR
      EXISTS (
        SELECT 1 FROM user_profiles
        WHERE id = auth.uid() AND is_admin = true
      )
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