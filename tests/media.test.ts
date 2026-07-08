import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { buildServer } from '../src/server.js';

let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof buildServer>;
let tempDir: string;

// Minimal valid JPEG: SOI + APP0 (JFIF header) + EOI.
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

// Minimal PNG signature + a few bytes.
const TINY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

beforeEach(async () => {
  db = openDb(':memory:');
  app = buildServer({ db, archiveDir: '/tmp/na', cacheDir: '/tmp/na', engine: null });
  tempDir = await mkdtemp(join(tmpdir(), 'kintrace-media-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function seedItem(opts: { filePath?: string; thumbPath?: string | null; hash?: string } = {}): number {
  const { filePath = '/x.jpg', thumbPath = null, hash = 'h1' } = opts;
  return Number(
    db.prepare(
      "INSERT INTO items (file_path, content_hash, media_type, title, status, thumb_path) VALUES (?, ?, 'letter', 'A letter', 'transcribed', ?)"
    ).run(filePath, hash, thumbPath).lastInsertRowid
  );
}

describe('media streaming endpoints', () => {
  it('thumbnail 404 for missing item', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/items/999/thumbnail' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });
  });

  it('thumbnail 404 when thumb_path null', async () => {
    const id = seedItem();
    const res = await app.inject({ method: 'GET', url: `/api/items/${id}/thumbnail` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });
  });

  it('thumbnail 404 when file missing on disk', async () => {
    const id = seedItem({ thumbPath: join(tempDir, 'does-not-exist.jpg') });
    const res = await app.inject({ method: 'GET', url: `/api/items/${id}/thumbnail` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });
  });

  it('thumbnail streams jpeg', async () => {
    const thumbPath = join(tempDir, 'thumb.jpg');
    await writeFile(thumbPath, TINY_JPEG);
    const id = seedItem({ thumbPath });
    const res = await app.inject({ method: 'GET', url: `/api/items/${id}/thumbnail` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(res.rawPayload.length).toBeGreaterThan(0);
    expect(res.rawPayload.equals(TINY_JPEG)).toBe(true);
  });

  it('file 404 for missing item', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/items/999/file' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });
  });

  it('file streams with extension-inferred type', async () => {
    const filePath = join(tempDir, 'original.png');
    await writeFile(filePath, TINY_PNG);
    const id = seedItem({ filePath });
    const res = await app.inject({ method: 'GET', url: `/api/items/${id}/file` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.rawPayload.equals(TINY_PNG)).toBe(true);
  });

  it('file falls back to octet-stream', async () => {
    const filePath = join(tempDir, 'mystery.xyz');
    await writeFile(filePath, Buffer.from('unknown bytes'));
    const id = seedItem({ filePath });
    const res = await app.inject({ method: 'GET', url: `/api/items/${id}/file` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.rawPayload.toString()).toBe('unknown bytes');
  });
});
