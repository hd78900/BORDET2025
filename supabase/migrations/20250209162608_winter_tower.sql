/*
  # Fix admin profile

  1. Changes
    - Safely checks for existing admin user
    - Updates admin profile if user exists
    - Adds proper error handling
  
  2. Security
    - Only updates if auth user exists
    - Uses safe SQL operations
*/

DO $$ 
DECLARE
  admin_exists boolean;
BEGIN
  -- Check if admin exists in auth.users
  SELECT EXISTS (
    SELECT 1 FROM auth.users 
    WHERE email = 'hdanzin@gmail.com'
  ) INTO admin_exists;

  -- Only proceed if admin exists in auth.users
  IF admin_exists THEN
    -- Update or insert admin profile
    INSERT INTO user_profiles (id, email, is_admin)
    SELECT 
      id,
      email,
      true
    FROM auth.users
    WHERE email = 'hdanzin@gmail.com'
    ON CONFLICT (id) DO UPDATE 
    SET is_admin = true;
  END IF;
END $$;