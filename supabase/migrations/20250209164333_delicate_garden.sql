/*
  # Solution finale pour les politiques RLS
  
  1. Changements
    - Suppression de toutes les politiques existantes
    - Création d'une table temporaire pour stocker les admins
    - Utilisation de cette table pour les vérifications sans récursion
    - Nouvelles politiques simples et directes
  
  2. Sécurité
    - Évite complètement la récursion
    - Maintient la sécurité des données
    - Préserve les fonctionnalités admin
*/

-- 1. Créer une table temporaire pour les admins
CREATE TABLE IF NOT EXISTS admin_cache (
  user_id uuid PRIMARY KEY,
  is_admin boolean DEFAULT true,
  last_updated timestamptz DEFAULT now()
);

-- 2. Copier les admins existants
INSERT INTO admin_cache (user_id)
SELECT id FROM user_profiles WHERE is_admin = true
ON CONFLICT (user_id) DO NOTHING;

-- 3. Supprimer toutes les politiques existantes
DROP POLICY IF EXISTS "select_policy" ON user_profiles;
DROP POLICY IF EXISTS "insert_policy" ON user_profiles;
DROP POLICY IF EXISTS "update_policy" ON user_profiles;
DROP POLICY IF EXISTS "delete_policy" ON user_profiles;

-- 4. Créer de nouvelles politiques utilisant admin_cache
CREATE POLICY "basic_access_policy"
  ON user_profiles
  FOR ALL
  TO authenticated
  USING (
    -- Accès à son propre profil
    id = auth.uid()
    OR 
    -- Accès admin via la table cache
    EXISTS (SELECT 1 FROM admin_cache WHERE user_id = auth.uid())
  )
  WITH CHECK (
    -- Même logique pour les modifications
    id = auth.uid()
    OR 
    EXISTS (SELECT 1 FROM admin_cache WHERE user_id = auth.uid())
  );

-- 5. Créer un trigger pour maintenir admin_cache à jour
CREATE OR REPLACE FUNCTION sync_admin_cache()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_admin = true THEN
    INSERT INTO admin_cache (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    DELETE FROM admin_cache WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_admin_cache_trigger
AFTER INSERT OR UPDATE OF is_admin ON user_profiles
FOR EACH ROW
EXECUTE FUNCTION sync_admin_cache();