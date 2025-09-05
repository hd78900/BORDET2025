/*
  # Fix user display permissions

  1. Changes
    - Add policy to allow admins to view all user profiles
    - Add policy to allow users to view their own profile
    - Update existing policies for clarity and security

  2. Security
    - Maintains strict RLS
    - Ensures proper access control
*/

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Les administrateurs peuvent tout voir" ON user_profiles;
DROP POLICY IF EXISTS "Les utilisateurs peuvent voir leur profil" ON user_profiles;

-- Create new, more specific policies
CREATE POLICY "Admins can view all profiles"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE POLICY "Users can view their own profile"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());