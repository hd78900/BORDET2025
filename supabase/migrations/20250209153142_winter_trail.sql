/*
  # Fix Admin Policies for User Profiles

  1. Changes
    - Drop existing policies
    - Create new policy for admin to view and manage all profiles
    - Create policy for users to view their own profile
    - Create policy for admins to create new users
    - Create policy for admins to update profiles

  2. Security
    - Admins can view and manage all profiles
    - Users can only view their own profile
    - Only admins can create new users
*/

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Les administrateurs peuvent créer des utilisateurs" ON user_profiles;

-- Create comprehensive admin policy
CREATE POLICY "Admins can manage all profiles"
  ON user_profiles
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

-- Create user self-view policy
CREATE POLICY "Users can view their own profile"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());