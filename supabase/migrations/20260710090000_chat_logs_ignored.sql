-- "Ignorer" une question sans réponse depuis /analytics : flag `ignored` + droit UPDATE admin.
-- La question ignorée disparaît de la liste « trous de la base » pour TOUS les admins (persistant),
-- sans supprimer le transcript. Idempotent.

ALTER TABLE public.chat_logs ADD COLUMN IF NOT EXISTS ignored boolean NOT NULL DEFAULT false;

-- les admins connectés peuvent marquer une ligne comme ignorée (lecture déjà couverte par chat_logs_select_admin)
GRANT UPDATE ON public.chat_logs TO authenticated;
DROP POLICY IF EXISTS chat_logs_update_admin ON public.chat_logs;
CREATE POLICY chat_logs_update_admin ON public.chat_logs
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.is_admin));

NOTIFY pgrst, 'reload schema';
