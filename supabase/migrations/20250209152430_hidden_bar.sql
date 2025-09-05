/*
  # Ajout d'une politique RLS pour la création d'utilisateurs

  1. Nouvelle politique
    - Permet aux administrateurs de créer de nouveaux utilisateurs
    - S'applique uniquement aux opérations INSERT
    - Vérifie que l'utilisateur qui fait l'insertion est un administrateur

  2. Sécurité
    - Restreint la création d'utilisateurs aux administrateurs uniquement
    - Utilise la table user_profiles pour la vérification
*/

CREATE POLICY "Les administrateurs peuvent créer des utilisateurs"
  ON user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );