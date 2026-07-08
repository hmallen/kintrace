import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { openDb } from '../src/db.js';
import { importFile } from '../src/importer.js';

let dirs: { src: string; archiveDir: string; cacheDir: string };

beforeEach(() => {
  dirs = {
    src: mkdtempSync(join(tmpdir(), 'kt-src-')),
    archiveDir: mkdtempSync(join(tmpdir(), 'kt-arc-')),
    cacheDir: mkdtempSync(join(tmpdir(), 'kt-cache-')),
  };
});

async function makeTestImage(path: string) {
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#888' } })
    .jpeg()
    .toFile(path);
}

describe('importFile', () => {
  it('copies file to archive, makes thumbnail, inserts pending item', async () => {
    const db = openDb(':memory:');
    const src = join(dirs.src, 'letter-p1.jpg');
    await makeTestImage(src);

    const result = await importFile(db, src, { ...dirs, mediaType: 'letter' });
    expect(result.duplicate).toBe(false);

    const item: any = db.prepare('SELECT * FROM items WHERE id = ?').get(result.itemId);
    expect(item.status).toBe('pending');
    expect(item.media_type).toBe('letter');
    expect(existsSync(item.file_path)).toBe(true);
    expect(item.file_path.startsWith(dirs.archiveDir)).toBe(true);
    expect(readdirSync(dirs.cacheDir).length).toBe(1); // thumbnail
  });

  it('detects duplicates by content hash', async () => {
    const db = openDb(':memory:');
    const src = join(dirs.src, 'photo.jpg');
    await makeTestImage(src);
    const first = await importFile(db, src, { ...dirs, mediaType: 'photo' });
    const second = await importFile(db, src, { ...dirs, mediaType: 'photo' });
    expect(second.duplicate).toBe(true);
    expect(second.itemId).toBe(first.itemId);
  });

  it('imports non-image files without a thumbnail', async () => {
    const db = openDb(':memory:');
    const src = join(dirs.src, 'interview.mp3');
    writeFileSync(src, Buffer.from('fake audio bytes'));
    const result = await importFile(db, src, { ...dirs, mediaType: 'audio' });
    expect(result.duplicate).toBe(false);
    expect(readdirSync(dirs.cacheDir).length).toBe(0);
  });

  it('resolves a concurrent duplicate-import race to a single winner', async () => {
    const db = openDb(':memory:');
    const src = join(dirs.src, 'race.jpg');
    await makeTestImage(src);

    const [a, b] = await Promise.all([
      importFile(db, src, { ...dirs, mediaType: 'photo' }),
      importFile(db, src, { ...dirs, mediaType: 'photo' }),
    ]);

    const dupFlags = [a.duplicate, b.duplicate].sort();
    expect(dupFlags).toEqual([false, true]);
    expect(a.itemId).toBe(b.itemId);

    expect(readdirSync(dirs.archiveDir).length).toBe(1);
    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('cleans up the archive copy when thumbnailing a corrupt image fails', async () => {
    const db = openDb(':memory:');
    const src = join(dirs.src, 'corrupt.jpg');
    writeFileSync(src, Buffer.from('not a real jpeg'));

    await expect(importFile(db, src, { ...dirs, mediaType: 'photo' })).rejects.toThrow();

    expect(readdirSync(dirs.archiveDir).length).toBe(0);
    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(0);
  });
});
