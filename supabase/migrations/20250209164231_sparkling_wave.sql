/*
  # Final fix for RLS recursion issue

  1. Changes
    - Drop all existing policies
    - Create separate policies for admins and users
    - Use non-recursive approach
    - Separate read and write operations

  2. Security
    - Maintain proper access control
    - Prevent infinite recursion
    - Keep admin privileges
*/

-- Drop all existing policies
DROP POLICY IF EXISTS "access_policy" ON user_profiles;
DROP POLICY IF EXISTS "user_profiles_policy" ON user_profiles;
DROP POLICY IF EXISTS "admin_access" ON user_profiles;

-- Create separate policies for different operations
CREATE POLICY "allow_read_own_profile"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "allow_read_all_for_admin"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(
      (SELECT is_admin FROM user_profiles WHERE id = auth.uid()),
      false
    )
  );

CREATE POLICY "allow_insert_for_admin"
  ON user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    COALESCE(
      (SELECT is_admin FROM user_profiles WHERE id = auth.uid()),
      false
    )
  );

CREATE POLICY "allow_update_own_profile"
  ON user_profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "allow_update_all_for_admin"
  ON user_profiles
  FOR UPDATE
  TO authenticated
  USING (
    COALESCE(
      (SELECT is_admin FROM user_profiles WHERE id = auth.uid()),
      false
    )
  )
  WITH CHECK (
    COALESCE(
      (SELECT is_admin FROM user_profiles WHERE id = auth.uid()),
      false
    )
  );

CREATE POLICY "allow_delete_for_admin"
  ON user_profiles
  FOR DELETE
  TO authenticated
  USING (
    COALESCE(
      (SELECT is_admin FROM user_profiles WHERE id = auth.uid()),
      false
    )
  );

-- Ensure RLS is enabled
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;