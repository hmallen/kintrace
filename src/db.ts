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
CREATE TABLE IF NOT EXISTS item_groups (
  id INTEGER PRIMARY KEY,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS item_group_members (
  group_id INTEGER NOT NULL REFERENCES item_groups(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, item_id)
);
CREATE INDEX IF NOT EXISTS item_group_members_group_position
  ON item_group_members (group_id, position, item_id);
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
CREATE TABLE IF NOT EXISTS gedcom_imports (
  id INTEGER PRIMARY KEY,
  original_filename TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  archived_file_path TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS gedcom_review_items (
  id INTEGER PRIMARY KEY,
  gedcom_import_id INTEGER NOT NULL REFERENCES gedcom_imports(id) ON DELETE CASCADE,
  group_type TEXT NOT NULL CHECK (group_type IN ('people','relationships','events')),
  label TEXT NOT NULL,
  gedcom_xref TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS gedcom_review_items_import_group_status
  ON gedcom_review_items (gedcom_import_id, group_type, status);
CREATE TABLE IF NOT EXISTS gedcom_xrefs (
  id INTEGER PRIMARY KEY,
  gedcom_import_id INTEGER NOT NULL REFERENCES gedcom_imports(id) ON DELETE CASCADE,
  gedcom_xref TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person','family','event')),
  entity_id INTEGER,
  UNIQUE (gedcom_import_id, gedcom_xref, entity_type)
);
CREATE TABLE IF NOT EXISTS person_relationships (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  related_person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK (relationship IN ('parent','child','spouse')),
  gedcom_import_id INTEGER REFERENCES gedcom_imports(id) ON DELETE SET NULL,
  UNIQUE (person_id, related_person_id, relationship, gedcom_import_id)
);
CREATE TABLE IF NOT EXISTS timeline_story (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  story_json TEXT NOT NULL,
  source_references_json TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  source_count INTEGER NOT NULL,
  model TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  ensureColumn(db, 'events', 'gedcom_import_id', 'INTEGER REFERENCES gedcom_imports(id) ON DELETE SET NULL');
  ensureColumn(db, 'events', 'gedcom_xref', 'TEXT');
  ensureColumn(db, 'events', 'gedcom_tag', 'TEXT');
  ensureColumn(db, 'events', 'gedcom_date_raw', 'TEXT');
  ensureColumn(db, 'events', 'source_text', 'TEXT');
  ensureColumn(db, 'items', 'original_filename', 'TEXT');
  return db;
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (existing.some((info) => info.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
