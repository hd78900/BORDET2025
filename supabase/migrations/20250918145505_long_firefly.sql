/*
  # Corriger les permissions pour widget_settings

  1. Permissions
    - Permettre l'accès public en lecture à la table widget_settings
    - Seuls les admins peuvent modifier les paramètres
  
  2. Sécurité
    - RLS activé mais avec politique publique pour la lecture
    - Écriture réservée aux administrateurs
*/

-- S'assurer que la table existe
CREATE TABLE IF NOT EXISTS widget_settings (
  id integer PRIMARY KEY DEFAULT 1,
  enabled boolean DEFAULT true,
  title text DEFAULT 'Assistant Bordet',
  welcome_message text DEFAULT 'Comment puis-je vous aider ?',
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT single_row_check CHECK (id = 1)
);

-- Insérer la ligne par défaut si elle n'existe pas
INSERT INTO widget_settings (id, enabled, title, welcome_message)
VALUES (1, true, 'Assistant Bordet', 'Comment puis-je vous aider ?')
ON CONFLICT (id) DO NOTHING;

-- Activer RLS
ALTER TABLE widget_settings ENABLE ROW LEVEL SECURITY;

-- Supprimer les anciennes politiques
DROP POLICY IF EXISTS "Public read access for widget settings" ON widget_settings;
DROP POLICY IF EXISTS "Admin write access for widget settings" ON widget_settings;

-- Politique de lecture publique (pour l'API widget-status)
CREATE POLICY "Public read access for widget settings"
  ON widget_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Politique d'écriture pour les admins seulement
CREATE POLICY "Admin write access for widget settings"
  ON widget_settings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_profiles.id = auth.uid() 
      AND user_profiles.is_admin = true
    )
  );

-- Fonction pour mettre à jour updated_at
CREATE OR REPLACE FUNCTION update_widget_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour updated_at
DROP TRIGGER IF EXISTS update_widget_settings_updated_at_trigger ON widget_settings;
CREATE TRIGGER update_widget_settings_updated_at_trigger
  BEFORE UPDATE ON widget_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_widget_settings_updated_at();