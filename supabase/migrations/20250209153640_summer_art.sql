-- Drop all existing policies to start fresh
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON user_profiles;

-- Create a policy for initial admin access (no recursion)
CREATE POLICY "Initial admin access"
  ON user_profiles
  FOR ALL
  TO authenticated
  USING (
    -- Allow access to own profile
    id = auth.uid()
    OR
    -- Or if user is an admin (checking the current row)
    is_admin = true
  )
  WITH CHECK (
    -- Allow modifications if it's the user's own profile
    id = auth.uid()
    OR
    -- Or if the user is an admin (checking the current row)
    is_admin = true
  );