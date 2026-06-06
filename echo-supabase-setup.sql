-- ═══════════════════════════════════════════════════════════
--  ECHO APP — Supabase Database Setup
--  Run this entire script in your Supabase SQL Editor once.
-- ═══════════════════════════════════════════════════════════

-- 1. Diary Entries table
CREATE TABLE IF NOT EXISTS diary_entries (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  date            date        NOT NULL,
  ticket_number   text,
  title           text        NOT NULL,
  feedback        text,
  mood            text,
  tags            text[]      DEFAULT '{}',
  content         text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- Index for fast date lookups
CREATE INDEX IF NOT EXISTS diary_entries_date_idx ON diary_entries (date DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS diary_entries_updated_at ON diary_entries;
CREATE TRIGGER diary_entries_updated_at
  BEFORE UPDATE ON diary_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Documents table
CREATE TABLE IF NOT EXISTS documents (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name            text        NOT NULL,
  category        text,
  description     text,
  file_path       text        NOT NULL,
  file_size       bigint,
  file_type       text,
  tags            text[]      DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS documents_category_idx ON documents (category);
CREATE INDEX IF NOT EXISTS documents_created_idx  ON documents (created_at DESC);

-- ═══════════════════════════════════════════════════════════
--  Row Level Security (optional — enable if you add auth)
-- ═══════════════════════════════════════════════════════════
-- ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Public access" ON diary_entries FOR ALL USING (true);
-- CREATE POLICY "Public access" ON documents     FOR ALL USING (true);

-- ═══════════════════════════════════════════════════════════
--  Storage bucket — create manually in Supabase Dashboard:
--  Storage → New bucket → Name: "echo-documents" → Public
-- ═══════════════════════════════════════════════════════════
