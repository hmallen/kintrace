import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { importGedcomFile } from '../src/gedcom/importer.js';

let dir: string;
let db: ReturnType<typeof openDb>;

const SAMPLE_GEDCOM = [
  '0 HEAD',
  '1 CHAR UTF-8',
  '0 @I1@ INDI',
  '1 NAME John /Smith/',
  '1 BIRT',
  '2 DATE 12 MAY 1901',
  '2 PLAC Iowa',
  '1 DEAT',
  '2 DATE 1970',
  '1 NOTE Farmer',
  '0 @I2@ INDI',
  '1 NAME Jane /Jones/',
  '1 BIRT',
  '2 DATE ABT 1903',
  '0 @I3@ INDI',
  '1 NAME Alice /Smith/',
  '1 BIRT',
  '2 DATE 1930',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '1 CHIL @I3@',
  '1 MARR',
  '2 DATE 1924',
  '2 PLAC Cedar Rapids, Iowa',
].join('\n');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kt-gedcom-'));
  db = openDb(':memory:');
});

function writeSample(name = 'tree.ged'): string {
  const file = join(dir, name);
  writeFileSync(file, SAMPLE_GEDCOM, 'utf8');
  return file;
}

describe('importGedcomFile', () => {
  it('queues grouped people, relationships, and events without changing live data', async () => {
    const result = await importGedcomFile(db, writeSample(), {
      archiveDir: join(dir, 'archive'),
      originalFilename: 'tree.ged',
    });

    expect(result.duplicate).toBe(false);
    expect(result.counts).toEqual({
      peopleQueued: 3,
      relationshipsQueued: 3,
      eventsQueued: 5,
      warnings: 0,
    });

    expect(db.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM person_relationships').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 0 });
    expect(db.prepare(
      'SELECT group_type, COUNT(*) AS count FROM gedcom_review_items GROUP BY group_type ORDER BY group_type'
    ).all()).toEqual([
      { group_type: 'events', count: 5 },
      { group_type: 'people', count: 3 },
      { group_type: 'relationships', count: 3 },
    ]);
    const john = db.prepare(
      "SELECT payload_json, status FROM gedcom_review_items WHERE group_type = 'people' AND label = 'John Smith'"
    ).get() as { payload_json: string; status: string };
    expect(JSON.parse(john.payload_json)).toMatchObject({
      name: 'John Smith',
      birthStart: '1901-05-12',
      deathStart: '1970-01-01',
      notes: 'GEDCOM notes:\nFarmer',
    });
    expect(john.status).toBe('pending');
  });

  it('returns the previous import for duplicate file content', async () => {
    const source = writeSample();
    const first = await importGedcomFile(db, source, {
      archiveDir: join(dir, 'archive'),
      originalFilename: 'tree.ged',
    });
    const second = await importGedcomFile(db, source, {
      archiveDir: join(dir, 'archive'),
      originalFilename: 'tree-copy.ged',
    });

    expect(second).toEqual({ ...first, duplicate: true });
    expect(db.prepare('SELECT COUNT(*) AS count FROM gedcom_review_items').get()).toEqual({ count: 11 });
  });

  it('rolls back database rows and removes the archived copy if import fails', async () => {
    db.prepare(
      "CREATE TRIGGER fail_review BEFORE INSERT ON gedcom_review_items BEGIN SELECT RAISE(ABORT, 'boom'); END;"
    ).run();
    const archiveDir = join(dir, 'archive');

    await expect(
      importGedcomFile(db, writeSample(), {
        archiveDir,
        originalFilename: 'tree.ged',
      }),
    ).rejects.toThrow('boom');

    expect(db.prepare('SELECT COUNT(*) AS count FROM gedcom_imports').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM gedcom_review_items').get()).toEqual({ count: 0 });
    expect(readdirSync(archiveDir)).toEqual([]);
  });
});
