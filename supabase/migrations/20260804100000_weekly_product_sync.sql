/*
  # Synchronisation hebdomadaire du catalogue produits (feed Doofinder)

  Remplace le lancement manuel de `scripts/ingest_products_feed.py`.
  Fournit à l'Edge Function `sync-products` :
    1. `product_feed_fingerprints` : empreinte SHA-256 du `content` de chaque fiche produit déjà
       en base -> la fonction ne ré-embedde que ce qui a changé (prix, dispo, description, nouveautés).
       Renvoyer l'empreinte plutôt que le contenu garde la réponse légère (~90 octets/fiche).
    2. `product_feed_prune` : supprime les fiches issues du feed qui n'y figurent plus (produits
       retirés du catalogue). Bornée aux documents `added_via = 'feed'` : ne touche jamais au contenu
       ajouté à la main via l'admin (Base de connaissances).
    3. `product_sync_runs` : journal des exécutions (visible par les admins).
    4. Le cron hebdomadaire lui-même (pg_cron + pg_net).

  Les deux RPC sont SECURITY DEFINER et réservées à `service_role` : elles ne sont PAS appelables
  avec la clé anon.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1) Empreintes du catalogue produits déjà en base ----------------------------

CREATE OR REPLACE FUNCTION public.product_feed_fingerprints(p_bot_id text)
RETURNS TABLE (source_uid text, fp text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT d.source_uid,
         encode(extensions.digest(d.content, 'sha256'), 'hex')
  FROM public.documents d
  WHERE d.bot_id = p_bot_id
    AND d.source_uid IS NOT NULL
    AND d.metadata->>'source_type' = 'product';
$$;

REVOKE ALL ON FUNCTION public.product_feed_fingerprints(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_feed_fingerprints(text) TO service_role;

-- 2) Purge des fiches disparues du feed ---------------------------------------

CREATE OR REPLACE FUNCTION public.product_feed_prune(p_bot_id text, p_uids text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  n integer;
BEGIN
  -- Filet : jamais de purge sur une liste vide/suspecte (un feed en panne effacerait le catalogue).
  IF p_uids IS NULL OR array_length(p_uids, 1) IS NULL OR array_length(p_uids, 1) < 3000 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.documents d
  WHERE d.bot_id = p_bot_id
    AND d.metadata->>'source_type' = 'product'
    AND d.metadata->>'added_via' = 'feed'     -- ne touche pas aux ajouts manuels de l'admin
    AND d.source_uid IS NOT NULL
    AND NOT (d.source_uid = ANY (p_uids));

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.product_feed_prune(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_feed_prune(text, text[]) TO service_role;

-- 3) Journal des synchronisations ---------------------------------------------

CREATE TABLE IF NOT EXISTS public.product_sync_runs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL,                -- ok | partial | error | dry-run
  depth        integer NOT NULL DEFAULT 0,   -- rang dans la chaîne de relances
  duration_ms  integer,
  feed_rows    integer,
  products     integer,
  changed      integer,
  upserted     integer,
  deleted      integer,
  remaining    integer,
  chained      boolean,
  note         text,
  error        text
);

CREATE INDEX IF NOT EXISTS product_sync_runs_started_idx
  ON public.product_sync_runs (started_at DESC);

ALTER TABLE public.product_sync_runs ENABLE ROW LEVEL SECURITY;

-- Lecture réservée aux admins (le service_role écrit en contournant la RLS).
DROP POLICY IF EXISTS "product_sync_runs_select_admin" ON public.product_sync_runs;
CREATE POLICY "product_sync_runs_select_admin"
  ON public.product_sync_runs
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_admin));

-- 4) Purge du journal : on garde 180 jours ------------------------------------

CREATE OR REPLACE FUNCTION public.prune_product_sync_runs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.product_sync_runs WHERE started_at < now() - interval '180 days';
$$;

REVOKE ALL ON FUNCTION public.prune_product_sync_runs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_product_sync_runs() TO service_role;
