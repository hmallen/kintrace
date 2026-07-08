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
});
