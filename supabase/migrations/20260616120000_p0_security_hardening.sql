-- P0 sécurité — ferme le dump RLS, borne match_documents, circuit-breaker de coût, kill-switch.
-- À exécuter dans le SQL editor Supabase (ou `supabase db push`). Idempotent.

-- 1) Couper l'accès DIRECT anon à documents (empêche la pagination/exfiltration des 3063 chunks)
DROP POLICY IF EXISTS "select_documents_anon" ON public.documents;
REVOKE ALL ON TABLE public.documents FROM anon;

-- 2) match_documents : SECURITY DEFINER borné (top-8), livres exclus pour le PUBLIC (anon),
--    conservés pour l'ADMIN connecté (authenticated). Contrat de retour inchangé (metadata jsonb)
--    -> ne casse pas extractProductsFromContext / sanitizeUrls côté front.
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector(1024),
  match_count int DEFAULT 8,
  filter_bot_id text DEFAULT 'bot1'
)
RETURNS TABLE (id bigint, content text, metadata jsonb, similarity float)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.id, d.content, d.metadata, 1 - (d.embedding OPERATOR(public.<=>) query_embedding) AS similarity
  FROM public.documents d
  WHERE d.bot_id = coalesce(filter_bot_id, 'bot1')
    AND (
      coalesce(d.metadata->>'source_type','') <> 'book'
      OR coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','anon') = 'authenticated'
    )
  ORDER BY d.embedding OPERATOR(public.<=>) query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 8);
$$;
ALTER FUNCTION public.match_documents(vector, int, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.match_documents(vector, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.match_documents(vector, int, text) TO anon, authenticated;

-- 3) Kill-switch : flag sur widget_settings (row id=1). false => le proxy renvoie 503.
ALTER TABLE public.widget_settings ADD COLUMN IF NOT EXISTS proxy_enabled boolean NOT NULL DEFAULT true;

-- 4) Circuit-breaker de coût : budget de tokens quotidien (la SEULE mesure qui borne la
--    dépense même après fuite de tout token).
CREATE TABLE IF NOT EXISTS public.daily_token_budget (
  day date PRIMARY KEY,
  tokens_used bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.daily_token_budget ENABLE ROW LEVEL SECURITY;
-- aucune policy -> inaccessible à anon/authenticated ; seules les fonctions DEFINER y touchent.

-- réservation ATOMIQUE pré-appel (+ check kill-switch). true = autorisé.
-- Le pré-incrément conditionnel en une requête évite la race "check-then-act".
CREATE OR REPLACE FUNCTION public.reserve_token_budget(p_reserve int, p_cap bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.widget_settings WHERE proxy_enabled = false) THEN
    RETURN false;                       -- kill-switch
  END IF;
  INSERT INTO public.daily_token_budget(day, tokens_used)
    VALUES (current_date, 0) ON CONFLICT (day) DO NOTHING;
  UPDATE public.daily_token_budget
     SET tokens_used = tokens_used + p_reserve
   WHERE day = current_date AND tokens_used + p_reserve <= p_cap;
  RETURN FOUND;                         -- false si le plafond serait dépassé
END $$;

-- réconciliation post-appel avec le coût réel (delta = réel - réservé, peut être négatif).
CREATE OR REPLACE FUNCTION public.reconcile_token_budget(p_delta int)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.daily_token_budget
     SET tokens_used = GREATEST(0, tokens_used + p_delta)
   WHERE day = current_date;
$$;

ALTER FUNCTION public.reserve_token_budget(int, bigint) OWNER TO postgres;
ALTER FUNCTION public.reconcile_token_budget(int) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_token_budget(int, bigint) FROM public;
REVOKE ALL ON FUNCTION public.reconcile_token_budget(int) FROM public;
GRANT EXECUTE ON FUNCTION public.reserve_token_budget(int, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_token_budget(int) TO service_role;

NOTIFY pgrst, 'reload schema';
