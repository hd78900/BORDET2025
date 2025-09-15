/*
  # Création de la table des paramètres du widget

  1. Nouvelle table
    - `widget_settings`
      - `id` (integer, primary key) - Un seul enregistrement
      - `enabled` (boolean) - Widget activé/désactivé
      - `title` (text) - Titre du widget
      - `welcome_message` (text) - Message de bienvenue
      - `updated_at` (timestamp) - Dernière mise à jour

  2. Sécurité
    - Pas de RLS car table de configuration globale
    - Accès admin uniquement via l'application

  3. Données initiales
    - Un enregistrement par défaut avec widget activé
*/

CREATE TABLE IF NOT EXISTS widget_settings (
  id integer PRIMARY KEY DEFAULT 1,
  enabled boolean DEFAULT true,
  title text DEFAULT 'Assistant Bordet',
  welcome_message text DEFAULT 'Comment puis-je vous aider ?',
  updated_at timestamptz DEFAULT now()
);

-- Contrainte pour s'assurer qu'il n'y a qu'un seul enregistrement
ALTER TABLE widget_settings ADD CONSTRAINT single_row_check CHECK (id = 1);

-- Insérer l'enregistrement par défaut
INSERT INTO widget_settings (id, enabled, title, welcome_message) 
VALUES (1, true, 'Assistant Bordet', 'Comment puis-je vous aider ?')
ON CONFLICT (id) DO NOTHING;

-- Trigger pour mettre à jour automatiquement updated_at
CREATE OR REPLACE FUNCTION update_widget_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_widget_settings_updated_at_trigger
  BEFORE UPDATE ON widget_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_widget_settings_updated_at();