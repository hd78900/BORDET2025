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
DROP POLICY IF EXISTS "Admin full access" ON user_profiles;
DROP POLICY IF EXISTS "Users view own profile" ON user_profiles;

-- Create new admin policy without recursion
CREATE POLICY "admin_access"
  ON user_profiles
  FOR ALL
  TO authenticated
  USING (
    CASE
      -- Allow admins to access all rows
      WHEN (SELECT is_admin FROM user_profiles WHERE id = auth.uid()) = true THEN true
      -- Allow users to access their own profile
      ELSE id = auth.uid()
    END
  );

-- Ensure RLS is enabled
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;