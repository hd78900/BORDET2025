/*
  # Création des tables d'authentification et d'autorisation

  1. Nouvelles Tables
    - `user_profiles`
      - `id` (uuid, clé primaire)
      - `email` (text, unique)
      - `is_admin` (boolean)
      - `created_at` (timestamp)
    - `user_bot_access`
      - `user_id` (uuid, clé étrangère)
      - `bot_id` (text)
      - `created_at` (timestamp)

  2. Sécurité
    - RLS activé sur toutes les tables
    - Politiques pour les administrateurs et les utilisateurs
*/

-- Table des profils utilisateurs
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  email text UNIQUE NOT NULL,
  is_admin boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Politique pour les administrateurs
CREATE POLICY "Les administrateurs peuvent tout voir"
  ON user_profiles
  FOR ALL
  TO authenticated
  USING (is_admin = true);

-- Politique pour les utilisateurs
CREATE POLICY "Les utilisateurs peuvent voir leur profil"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Table des accès aux chatbots
CREATE TABLE IF NOT EXISTS user_bot_access (
  user_id uuid REFERENCES user_profiles(id),
  bot_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, bot_id)
);

ALTER TABLE user_bot_access ENABLE ROW LEVEL SECURITY;

-- Politique pour les administrateurs
CREATE POLICY "Les administrateurs peuvent gérer les accès"
  ON user_bot_access
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Politique pour les utilisateurs
CREATE POLICY "Les utilisateurs peuvent voir leurs accès"
  ON user_bot_access
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());