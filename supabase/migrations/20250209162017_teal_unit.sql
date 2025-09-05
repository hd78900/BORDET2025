/*
  # Fix Admin User Profile Creation

  1. Changes
    - Creates a function to safely check and create admin profile
    - Only creates profile if auth user exists
    - Uses proper error handling
    
  2. Security
    - Checks for existing auth user
    - Uses proper RLS policies
    - Maintains referential integrity
*/

-- Create a function to safely check and create admin profile
CREATE OR REPLACE FUNCTION check_and_create_admin_profile()
RETURNS void AS $$
DECLARE
  admin_exists boolean;
BEGIN
  -- Check if the auth user exists
  SELECT EXISTS (
    SELECT 1 FROM auth.users 
    WHERE id = 'c40ca490-5a7f-468a-a360-ede9df5a0845'::uuid
  ) INTO admin_exists;

  -- Only proceed if the auth user exists
  IF admin_exists THEN
    -- Update or insert the admin profile
    UPDATE user_profiles 
    SET is_admin = true 
    WHERE id = 'c40ca490-5a7f-468a-a360-ede9df5a0845'::uuid;
    
    -- If no update was made (profile doesn't exist), try to insert
    IF NOT FOUND THEN
      -- Only insert if the auth user exists (double-check to prevent race conditions)
      INSERT INTO user_profiles (id, email, is_admin)
      SELECT 
        'c40ca490-5a7f-468a-a360-ede9df5a0845'::uuid,
        'hdanzin@gmail.com',
        true
      WHERE EXISTS (
        SELECT 1 FROM auth.users 
        WHERE id = 'c40ca490-5a7f-468a-a360-ede9df5a0845'::uuid
      );
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Execute the function
SELECT check_and_create_admin_profile();

-- Clean up
DROP FUNCTION check_and_create_admin_profile();