-- pgvector schema for NoLoop RAG (Supabase Postgres).
-- Apply with: psql "$DATABASE_URL" -f app/rag/schema.sql
-- The embedding dimension MUST match NOLOOP_EMBEDDING_DIM / your model
-- (all-MiniLM-L6-v2 = 384; bge-small-en-v1.5 = 384; hashing default = 256).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_chunks (
    id          TEXT PRIMARY KEY,          -- "<doc_id>#<ordinal>"
    namespace   TEXT NOT NULL,             -- scope, e.g. the policy number
    doc_id      TEXT NOT NULL,
    ref         TEXT NOT NULL,             -- clause reference used for citation
    heading     TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL,
    embedding   VECTOR(384),               -- <-- set to your model's dimension
    -- Generated full-text column for the BM25-ish lexical half of hybrid search.
    tsv         TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vector index (HNSW, cosine). Build after a bulk load for best quality.
CREATE INDEX IF NOT EXISTS rag_chunks_embedding_hnsw
    ON rag_chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Lexical index for full-text ranking.
CREATE INDEX IF NOT EXISTS rag_chunks_tsv_gin
    ON rag_chunks USING gin (tsv);

-- Namespace filter (every query is scoped to one policy's corpus).
CREATE INDEX IF NOT EXISTS rag_chunks_namespace
    ON rag_chunks (namespace);
