-- Prérequis de l'Edge Function `ingest-documents` (ajout de contenu depuis le back-office).
-- La fonction écrit dans la colonne `source_uid` et remplace une source par delete+insert.
-- Idempotent : rejouable sans risque. Sans doute déjà appliqué via ingest/sql/01_add_source_uid_and_hnsw.sql,
-- mais on le garantit ici pour que la fonction soit autoportante.

-- 1) colonne clé de source (une source = N chunks partageant metadata.source_group)
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS source_uid text;

-- 2) unicité (bot_id, source_uid) — cohérence des chunks par source
--    (NULLs multiples autorisés : n'impacte pas les lignes historiques sans source_uid)
CREATE UNIQUE INDEX IF NOT EXISTS documents_bot_source_uid_uniq
  ON public.documents (bot_id, source_uid);

-- 3) accélère la liste/suppression par source côté fonction (filtres sur metadata jsonb)
CREATE INDEX IF NOT EXISTS documents_metadata_gin
  ON public.documents USING gin (metadata);

NOTIFY pgrst, 'reload schema';
