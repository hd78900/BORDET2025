-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the documents table for storing embeddings
CREATE TABLE IF NOT EXISTS documents (
  id bigserial PRIMARY KEY,
  bot_id text NOT NULL,
  content text NOT NULL,
  metadata jsonb DEFAULT '{}',
  embedding vector(1024),
  created_at timestamptz DEFAULT now()
);

-- Create an index for fast vector similarity search
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Create an index on bot_id for filtering
CREATE INDEX ON documents (bot_id);

-- Enable RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read documents (knowledge base is shared)
CREATE POLICY "select_documents" ON documents FOR SELECT
  TO authenticated USING (true);

-- Only service role can insert/update/delete (via edge functions or admin)
CREATE POLICY "insert_documents_service" ON documents FOR INSERT
  TO service_role WITH CHECK (true);

CREATE POLICY "update_documents_service" ON documents FOR UPDATE
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "delete_documents_service" ON documents FOR DELETE
  TO service_role USING (true);

-- Also allow anon to select (for the widget which may not be authenticated)
CREATE POLICY "select_documents_anon" ON documents FOR SELECT
  TO anon USING (true);

-- Create the vector search function
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1024),
  match_count int DEFAULT 20,
  filter_bot_id text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM documents d
  WHERE (filter_bot_id IS NULL OR d.bot_id = filter_bot_id)
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;