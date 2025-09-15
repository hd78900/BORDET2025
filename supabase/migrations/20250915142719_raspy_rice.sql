/*
  # Create widget settings table

  1. New Tables
    - `widget_settings`
      - `id` (integer, primary key, always 1)
      - `enabled` (boolean, default true)
      - `title` (text, default 'Assistant Bordet')
      - `welcome_message` (text, default message)
      - `updated_at` (timestamp)

  2. Security
    - No RLS needed (public read access)
    - Single row constraint to ensure only one settings record

  3. Initial Data
    - Insert default settings with widget disabled for testing
*/

-- Create the widget_settings table
CREATE TABLE IF NOT EXISTS widget_settings (
  id integer PRIMARY KEY DEFAULT 1,
  enabled boolean DEFAULT false,
  title text DEFAULT 'Assistant Bordet',
  welcome_message text DEFAULT 'Comment puis-je vous aider ?',
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT single_row_check CHECK (id = 1)
);

-- Create trigger function for updated_at
CREATE OR REPLACE FUNCTION update_widget_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS update_widget_settings_updated_at_trigger ON widget_settings;
CREATE TRIGGER update_widget_settings_updated_at_trigger
  BEFORE UPDATE ON widget_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_widget_settings_updated_at();

-- Insert default settings (widget disabled by default)
INSERT INTO widget_settings (id, enabled, title, welcome_message)
VALUES (1, false, 'Assistant Bordet', 'Comment puis-je vous aider ?')
ON CONFLICT (id) DO NOTHING;