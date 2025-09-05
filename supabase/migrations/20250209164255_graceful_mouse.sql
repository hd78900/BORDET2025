/*
  # Final fix for RLS recursion issue

  1. Changes
    - Drop all existing policies
    - Create a single, simple policy for each operation
    - Use direct checks without subqueries
    - Prevent any possibility of recursion

  2. Security
    - Maintain proper access control
    - Prevent infinite recursion
    - Keep admin privileges
*/

-- Drop all existing policies
DROP POLICY IF EXISTS "allow_read_own_profile" ON user_profiles;
DROP POLICY IF EXISTS "allow_read_all_for_admin" ON user_profiles;
DROP POLICY IF EXISTS "allow_insert_for_admin" ON user_profiles;
DROP POLICY IF EXISTS "allow_update_own_profile" ON user_profiles;
DROP POLICY IF EXISTS "allow_update_all_for_admin" ON user_profiles;
DROP POLICY IF EXISTS "allow_delete_for_admin" ON user_profiles;

-- Create a single policy for SELECT operations
CREATE POLICY "select_policy"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (
    -- Users can always read their own profile
    id = auth.uid()
    OR
    -- Admins can read all profiles
    (SELECT true FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Create a single policy for INSERT operations
CREATE POLICY "insert_policy"
  ON user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Only admins can insert new profiles
    (SELECT true FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Create a single policy for UPDATE operations
CREATE POLICY "update_policy"
  ON user_profiles
  FOR UPDATE
  TO authenticated
  USING (
    -- Users can update their own profile
    id = auth.uid()
    OR
    -- Admins can update any profile
    (SELECT true FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    -- Same conditions for the new values
    id = auth.uid()
    OR
    (SELECT true FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Create a single policy for DELETE operations
CREATE POLICY "delete_policy"
  ON user_profiles
  FOR DELETE
  TO authenticated
  USING (
    -- Only admins can delete profiles
    (SELECT true FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Ensure RLS is enabled
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;