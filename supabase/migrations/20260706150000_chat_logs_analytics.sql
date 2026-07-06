-- Analytics conversations : table de logs alimentée par le mistral-proxy à CHAQUE échange
-- (y compris le widget public anonyme, aujourd'hui perdu). Append-only, service_role en écriture,
-- lecture réservée aux ADMINS (policy sur user_profiles.is_admin). RGPD : aucun IP ni identifiant
-- client ; purge des lignes > 90 jours par la fonction analytics (action digest).
-- Idempotent : rejouable sans risque.

CREATE TABLE IF NOT EXISTS public.chat_logs (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  conversation_id uuid NOT NULL,
  origin text NOT NULL DEFAULT 'widget',        -- widget | backoffice | playground
  mode text NOT NULL DEFAULT 'client',          -- client | marketing
  model text,
  question text NOT NULL,
  answer text NOT NULL,
  no_info boolean NOT NULL DEFAULT false,       -- réponse cannée "pas d'information" (aucun contexte RAG)
  match_count int,
  top_similarity real,
  sources_cited jsonb,                          -- URLs bordet.fr présentes dans la réponse finale
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  latency_ms int,
  -- remplis par le digest IA (fonction analytics) :
  topic text,
  intent text,
  outcome text,
  analyzed_at timestamptz
);

CREATE INDEX IF NOT EXISTS chat_logs_created_idx ON public.chat_logs (created_at);
CREATE INDEX IF NOT EXISTS chat_logs_conv_idx ON public.chat_logs (conversation_id);
CREATE INDEX IF NOT EXISTS chat_logs_pending_idx ON public.chat_logs (analyzed_at) WHERE analyzed_at IS NULL;

ALTER TABLE public.chat_logs ENABLE ROW LEVEL SECURITY;

-- écriture : service_role uniquement (le proxy) — aucune policy anon/authenticated en INSERT
DROP POLICY IF EXISTS chat_logs_insert_service ON public.chat_logs;
CREATE POLICY chat_logs_insert_service ON public.chat_logs
  FOR INSERT TO service_role WITH CHECK (true);

-- lecture : admins seulement (le dashboard lit en direct via supabase-js)
DROP POLICY IF EXISTS chat_logs_select_admin ON public.chat_logs;
CREATE POLICY chat_logs_select_admin ON public.chat_logs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_admin));

REVOKE ALL ON TABLE public.chat_logs FROM anon;

NOTIFY pgrst, 'reload schema';
