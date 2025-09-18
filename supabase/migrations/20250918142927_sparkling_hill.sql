/*
  # Ensure widget_settings table exists and is properly configured

  1. Table Structure
    - `widget_settings` table with proper columns
    - Single row constraint (id = 1)
    - Default values

  2. Security
    - No RLS (accessible via service key)
    - Public read access for the edge function

  3. Data
    - Insert default row if not exists
*/

-- Create table if not exists
CREATE TABLE IF NOT EXISTS widget_settings (
  id integer PRIMARY KEY DEFAULT 1,
  enabled boolean DEFAULT true,
  title text DEFAULT 'Assistant Bordet',
  welcome_message text DEFAULT 'Comment puis-je vous aider ?',
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT single_row_check CHECK (id = 1)
);

-- Ensure RLS is disabled for service key access
ALTER TABLE widget_settings DISABLE ROW LEVEL SECURITY;

-- Insert default row if not exists
INSERT INTO widget_settings (id, enabled, title, welcome_message)
VALUES (1, true, 'Assistant Bordet', 'Comment puis-je vous aider ?')
ON CONFLICT (id) DO NOTHING;

-- Create or replace the update trigger function
CREATE OR REPLACE FUNCTION update_widget_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if not exists
DROP TRIGGER IF EXISTS update_widget_settings_updated_at_trigger ON widget_settings;
CREATE TRIGGER update_widget_settings_updated_at_trigger
  BEFORE UPDATE ON widget_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_widget_settings_updated_at();