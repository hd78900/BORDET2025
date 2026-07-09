-- Anti-abus niveau 1 : rate-limit PAR UTILISATEUR (IP hachée / conversation).
-- Complète le circuit-breaker global (daily_token_budget) qui borne le coût mais pas
-- l'accaparement : sans ceci, un abuseur peut vider le budget du jour et rendre le bot
-- muet (503) pour les vrais clients. Idempotent : rejouable sans risque.

-- 1) Compteurs à fenêtre fixe : la fenêtre est encodée DANS la clé (ex. 'ip:<hash>:m:29384756'),
--    expires_at ne sert qu'au nettoyage. Aucune IP en clair (clé = hash salé, RGPD).
CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket text PRIMARY KEY,
  count int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON public.rate_limits (expires_at);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- aucune policy : table invisible pour anon/authenticated ; seule la fonction DEFINER y touche.

-- 2) Consommation ATOMIQUE : true = autorisé, false = limite atteinte.
--    Même patron que reserve_token_budget (préincrément conditionnel en une requête).
CREATE OR REPLACE FUNCTION public.consume_rate_limit(p_bucket text, p_max int, p_ttl_seconds int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- nettoyage opportuniste des fenêtres expirées (volume faible -> coût négligeable)
  DELETE FROM public.rate_limits WHERE expires_at < now();
  INSERT INTO public.rate_limits(bucket, count, expires_at)
    VALUES (p_bucket, 1, now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (bucket) DO UPDATE
    SET count = public.rate_limits.count + 1
    WHERE public.rate_limits.count < p_max;
  RETURN FOUND;   -- false si le compteur a atteint p_max
END $$;

ALTER FUNCTION public.consume_rate_limit(text, int, int) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.consume_rate_limit(text, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, int, int) TO service_role;

-- 3) Jauge budget dans /analytics : les ADMINS peuvent lire la consommation du jour.
DROP POLICY IF EXISTS daily_token_budget_select_admin ON public.daily_token_budget;
CREATE POLICY daily_token_budget_select_admin ON public.daily_token_budget
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_admin));

NOTIFY pgrst, 'reload schema';
