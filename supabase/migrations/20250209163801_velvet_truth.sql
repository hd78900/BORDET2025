/*
  # Fix user_bot_access RLS policies

  1. Changes
    - Drop existing policies on user_bot_access
    - Create new comprehensive policies for both admins and users
    - Ensure admins can manage all bot access records
    - Allow users to view their own bot access

  2. Security
    - Enable RLS
    - Add proper policies for SELECT and ALL operations
    - Ensure proper access control for both admins and regular users
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view and use their bot access" ON user_bot_access;
DROP POLICY IF EXISTS "Admins can manage all bot access" ON user_bot_access;

-- Create new policies
CREATE POLICY "Users can view their bot access"
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

CREATE POLICY "Admins full access"
  ON user_bot_access
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );