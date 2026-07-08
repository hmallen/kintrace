import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo','letter','article','audio','video','pdf')),
  title TEXT,
  description TEXT,
  date_start TEXT,
  date_end TEXT,
  date_precision TEXT NOT NULL DEFAULT 'unknown'
    CHECK (date_precision IN ('exact','month','year','decade','unknown')),
  transcription_diplomatic TEXT,
  transcription_normalized TEXT,
  ai_error TEXT,
  ai_names TEXT,
  ai_confidence TEXT,
  thumb_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','transcribed','reviewed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  UNIQUE (item_id, page_index)
);
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  birth_start TEXT, birth_end TEXT,
  birth_precision TEXT NOT NULL DEFAULT 'unknown',
  death_start TEXT, death_end TEXT,
  death_precision TEXT NOT NULL DEFAULT 'unknown',
  notes TEXT
);
CREATE TABLE IF NOT EXISTS item_people (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'subject' CHECK (role IN ('subject','author','recipient')),
  PRIMARY KEY (item_id, person_id, role)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  date_start TEXT, date_end TEXT,
  date_precision TEXT NOT NULL DEFAULT 'unknown',
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL
);
`;

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
