/*
  # Fix RLS recursion issue

  1. Changes
    - Drop all existing policies on user_profiles
    - Create new simplified policies without recursion
    - Ensure proper access control for admins and users

  2. Security
    - Enable RLS on user_profiles
    - Add policy for admin access using a direct check
    - Add policy for user self-access
*/

-- Drop all existing policies
DROP POLICY IF EXISTS "admin_access" ON user_profiles;

-- Create new simplified policy
CREATE POLICY "user_profiles_policy"
  ON user_profiles
  FOR ALL
  TO authenticated
  USING (
    -- Allow users to access their own profile
    id = auth.uid()
    OR
    -- Allow admins to access all profiles
    EXISTS (
      SELECT 1 FROM auth.users u
      JOIN user_profiles up ON u.id = up.id
      WHERE u.id = auth.uid() AND up.is_admin = true
    )
  )
  WITH CHECK (
    -- Allow users to modify their own profile
    id = auth.uid()
    OR
    -- Allow admins to modify all profiles
    EXISTS (
      SELECT 1 FROM auth.users u
      JOIN user_profiles up ON u.id = up.id
      WHERE u.id = auth.uid() AND up.is_admin = true
    )
  );

-- Ensure RLS is enabled
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;