import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  it('re-applies schema idempotently on an existing database file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kt-db-'));
    const path = join(dir, 'test.db');

    // First open: create database and schema
    const db1 = openDb(path);
    db1.prepare("INSERT INTO people (name) VALUES ('A')").run();
    db1.close();

    // Second open: schema should re-apply without error or data loss
    const db2 = openDb(path);
    const result = db2.prepare('SELECT COUNT(*) as count FROM people').get() as any;
    expect(result.count).toBe(1);
    db2.close();
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
