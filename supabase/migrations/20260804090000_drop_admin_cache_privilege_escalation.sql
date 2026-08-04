/*
  # Suppression de la table admin_cache (escalade de privileges) — lint 0013_rls_disabled_in_public

  ## Probleme
  `public.admin_cache` (creee en 02/2025 par la migration `20250209164333_delicate_garden.sql`
  pour contourner une recursion RLS) est exposee via PostgREST SANS RLS.
  Or la politique `basic_access_policy` d'`user_profiles` s'en sert pour decider qui est admin :

      EXISTS (SELECT 1 FROM admin_cache WHERE user_id = auth.uid())

  Consequence : n'importe quel compte authentifie pouvait s'inserer dans `admin_cache`
  (avec la cle anon, publique) et devenir admin, donc lire tous les profils puis passer
  `user_profiles.is_admin = true` sur lui-meme — ce que les edge functions
  (`analytics`, `ingest-documents`) traitent comme la source de verite.
  Un visiteur anonyme pouvait aussi lire la liste des UUID admins et vider la table.

  Second trou, independant : l'ancienne politique etait `FOR ALL ... WITH CHECK (id = auth.uid() ...)`,
  donc un utilisateur non-admin pouvait se promouvoir en modifiant SON PROPRE profil.

  ## Correction
  1. `is_admin_user()` en SECURITY DEFINER lit `user_profiles` en contournant la RLS
     (pas de recursion) => `admin_cache` devient inutile, et plus de risque de desynchronisation.
  2. Politiques `user_profiles` reecrites par operation, avec interdiction de s'auto-promouvoir.
  3. Trigger, fonction de synchro et table `admin_cache` supprimes.

  NB : le DROP TABLE est volontairement SANS CASCADE — s'il echoue, c'est qu'un autre objet
  depend encore d'`admin_cache` ; il faut l'inspecter plutot que de le supprimer en silence.
*/

-- 1) Verification d'admin sans recursion et sans table cache -------------------

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = (SELECT auth.uid())
      AND is_admin = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated, service_role;

-- 2) Politiques user_profiles --------------------------------------------------

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "basic_access_policy" ON public.user_profiles;

-- Lecture : son propre profil, ou tous les profils si admin (page gestion utilisateurs).
CREATE POLICY "user_profiles_select"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR public.is_admin_user()
  );

-- Creation : son propre profil (flux signUp de la page Admin) ou creation par un admin.
-- Un non-admin ne peut pas se creer avec is_admin = true.
CREATE POLICY "user_profiles_insert"
  ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (id = (SELECT auth.uid()) OR public.is_admin_user())
    AND (is_admin IS NOT TRUE OR public.is_admin_user())
  );

-- Modification : son propre profil ou n'importe lequel si admin.
-- Un non-admin ne peut pas se promouvoir admin.
CREATE POLICY "user_profiles_update"
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR public.is_admin_user()
  )
  WITH CHECK (
    (id = (SELECT auth.uid()) OR public.is_admin_user())
    AND (is_admin IS NOT TRUE OR public.is_admin_user())
  );

-- Suppression : admin uniquement.
CREATE POLICY "user_profiles_delete"
  ON public.user_profiles
  FOR DELETE
  TO authenticated
  USING (public.is_admin_user());

-- 3) Suppression de la backdoor ------------------------------------------------
-- Ordre impose : le trigger et la fonction referencent la table, la politique aussi
-- (elle vient d'etre remplacee ci-dessus).

DROP TRIGGER IF EXISTS sync_admin_cache_trigger ON public.user_profiles;
DROP FUNCTION IF EXISTS public.sync_admin_cache();
DROP TABLE IF EXISTS public.admin_cache;
