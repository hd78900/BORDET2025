/*
  # Force widget always enabled

  1. Changes
    - Updates `widget_settings` table to set `enabled` to `true`
    - Sets default value of `enabled` column to `true`
  
  2. Notes
    - The widget activity control has been removed from the application
    - The agent/widget is now always active by design
*/

UPDATE widget_settings SET enabled = true WHERE id = 1;

ALTER TABLE widget_settings ALTER COLUMN enabled SET DEFAULT true;
