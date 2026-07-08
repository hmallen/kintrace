import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db.js';

describe('openDb', () => {
  it('creates all tables in an in-memory db', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    for (const t of ['items', 'pages', 'people', 'item_people', 'events']) {
      expect(tables).toContain(t);
    }
  });

  it('is idempotent', () => {
    const db = openDb(':memory:');
    expect(() => openDb(':memory:')).not.toThrow();
    db.close();
  });

  it('enforces item status values', () => {
    const db = openDb(':memory:');
    expect(() =>
      db.prepare(
        "INSERT INTO items (file_path, content_hash, media_type, status) VALUES ('a', 'h', 'photo', 'bogus')"
      ).run()
    ).toThrow();
  });
});
