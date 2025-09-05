/*
  # Create admin user profile safely
  
  This migration creates a function to safely create an admin user profile
  only if the corresponding auth user exists.

  1. Changes
    - Add function to check for auth user existence
    - Safe insert/update of admin profile
    - Cleanup after execution
*/

CREATE OR REPLACE FUNCTION create_admin_profile()
RETURNS void AS $$
BEGIN
  -- Only create the profile if the auth user exists
  IF EXISTS (
    SELECT 1 FROM auth.users 
    WHERE id = 'c40ca490-5a7f-468a-a360-ede9df5a0845'::uuid
  ) THEN
    INSERT INTO user_profiles (id, email, is_admin)
    VALUES (
      'c40ca490-5a7f-468a-a360-ede9df5a0845'::uuid,
      'hdanzin@gmail.com',
      true
    )
    ON CONFLICT (id) DO UPDATE 
    SET is_admin = true;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Execute the function
SELECT create_admin_profile();

-- Clean up by dropping the function
DROP FUNCTION create_admin_profile();