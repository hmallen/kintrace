import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import FormData from 'form-data';
import { openDb } from '../src/db.js';
import { buildServer } from '../src/server.js';

let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof buildServer>;
let stagingDir: string;
let archiveDir: string;
let cacheDir: string;

async function makeJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 800, channels: 3, background: '#888' } })
    .jpeg()
    .toBuffer();
}

interface FilePart {
  name: string;
  data: Buffer;
}

function uploadForm(files: FilePart[], mediaType?: string, imageFallback?: string): FormData {
  const form = new FormData();
  if (mediaType !== undefined) form.append('mediaType', mediaType);
  if (imageFallback !== undefined) form.append('imageFallback', imageFallback);
  for (const f of files) {
    form.append('files', f.data, { filename: f.name, contentType: 'image/jpeg' });
  }
  return form;
}

async function postUpload(files: FilePart[], mediaType?: string, imageFallback?: string) {
  const form = uploadForm(files, mediaType, imageFallback);
  return app.inject({
    method: 'POST',
    url: '/api/upload',
    payload: form.getBuffer(),
    headers: form.getHeaders(),
  });
}

beforeEach(async () => {
  db = openDb(':memory:');
  stagingDir = await mkdtemp(join(tmpdir(), 'kt-staging-'));
  archiveDir = await mkdtemp(join(tmpdir(), 'kt-archive-'));
  cacheDir = await mkdtemp(join(tmpdir(), 'kt-cache-'));
  app = buildServer({ db, archiveDir, cacheDir, stagingDir, engine: null });
});

afterEach(async () => {
  await Promise.all(
    [stagingDir, archiveDir, cacheDir].map((d) => rm(d, { recursive: true, force: true }))
  );
});

describe('POST /api/upload', () => {
  it('uploads a file and imports it', async () => {
    const jpeg = await makeJpeg();
    const res = await postUpload([{ name: 'grandma.jpg', data: jpeg }], 'photo');
    expect(res.statusCode).toBe(200);
    const results = res.json();
    expect(results).toEqual([{
      path: 'grandma.jpg', itemId: expect.any(Number), duplicate: false,
      mediaType: 'photo', status: 'pending', autoSelected: false,
    }]);

    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(results[0].itemId) as
      | Record<string, unknown>
      | undefined;
    expect(row).toBeDefined();
    expect(row!.media_type).toBe('photo');

    expect(await readdir(stagingDir)).toEqual([]);
  });

  it('duplicate on second identical upload', async () => {
    const jpeg = await makeJpeg();
    const first = await postUpload([{ name: 'same.jpg', data: jpeg }], 'photo');
    const second = await postUpload([{ name: 'same.jpg', data: jpeg }], 'photo');
    expect(second.statusCode).toBe(200);
    const firstResult = first.json()[0];
    const secondResult = second.json()[0];
    expect(firstResult.duplicate).toBe(false);
    expect(secondResult.duplicate).toBe(true);
    expect(secondResult.itemId).toBe(firstResult.itemId);
  });

  it('multiple files in one request', async () => {
    const a = await makeJpeg();
    const b = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#345' } })
      .jpeg()
      .toBuffer();
    const res = await postUpload(
      [
        { name: 'first.jpg', data: a },
        { name: 'second.jpg', data: b },
      ],
      'photo'
    );
    expect(res.statusCode).toBe(200);
    const results = res.json();
    expect(results).toHaveLength(2);
    expect(results[0].path).toBe('first.jpg');
    expect(results[1].path).toBe('second.jpg');
    expect(results[0].duplicate).toBe(false);
    expect(results[1].duplicate).toBe(false);
    expect(results[0].itemId).not.toBe(results[1].itemId);
  });

  it('invalid mediaType 400', async () => {
    const jpeg = await makeJpeg();
    const res = await postUpload([{ name: 'x.jpg', data: jpeg }], 'bogus');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'mediaType must be auto or one of photo, letter, article, audio, video, pdf',
    });
  });

  it('per-file error is non-blocking', async () => {
    const good = await makeJpeg();
    const res = await postUpload(
      [
        { name: 'good.jpg', data: good },
        { name: 'corrupt.jpg', data: Buffer.alloc(0) },
      ],
      'photo'
    );
    expect(res.statusCode).toBe(200);
    const results = res.json();
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      path: 'good.jpg', itemId: expect.any(Number), duplicate: false,
      mediaType: 'photo', status: 'pending', autoSelected: false,
    });
    expect(results[1].path).toBe('corrupt.jpg');
    expect(typeof results[1].error).toBe('string');
    expect(results[1].itemId).toBeUndefined();
  });

  it('staging cleaned up', async () => {
    const good = await makeJpeg();
    // Mixed success/failure upload plus an invalid-mediaType upload: every path
    // must leave stagingDir empty.
    await postUpload(
      [
        { name: 'ok.jpg', data: good },
        { name: 'bad.jpg', data: Buffer.alloc(0) },
      ],
      'photo'
    );
    expect(await readdir(stagingDir)).toEqual([]);

    await postUpload([{ name: 'ok2.jpg', data: good }], 'bogus');
    expect(await readdir(stagingDir)).toEqual([]);
  });

  it('auto-detects reliable file formats and uses the chosen fallback for images', async () => {
    const jpeg = await makeJpeg();
    const res = await postUpload([{ name: 'diploma-scan.jpg', data: jpeg }], 'auto', 'pdf');
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ mediaType: 'pdf', autoSelected: true });
  });
});
