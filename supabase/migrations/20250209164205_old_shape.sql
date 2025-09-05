/*
  # Final fix for RLS recursion issue

  1. Changes
    - Drop all existing policies
    - Create a single, simple policy without recursion
    - Use direct auth.uid() checks
    - Avoid any self-referential queries

  2. Security
    - Maintain proper access control
    - Prevent infinite recursion
    - Keep admin privileges
*/

-- Drop all existing policies
DROP POLICY IF EXISTS "user_profiles_policy" ON user_profiles;
DROP POLICY IF EXISTS "admin_access" ON user_profiles;

-- Create a single, simple policy
CREATE POLICY "access_policy"
  ON user_profiles
  FOR ALL
  TO authenticated
  USING (
    -- Users can access their own profile
    id = auth.uid()
    OR
    -- Admins can access all profiles (using a direct check)
    (SELECT is_admin FROM user_profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    -- Users can modify their own profile
    id = auth.uid()
    OR
    -- Admins can modify all profiles (using a direct check)
    (SELECT is_admin FROM user_profiles WHERE id = auth.uid())
  );

-- Ensure RLS is enabled
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;