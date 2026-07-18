import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import FormData from 'form-data';
import sharp from 'sharp';
import { openDb } from '../src/db.js';
import {
  detectDocumentRegions,
  createVisionDocumentTypeClassifier,
  inferDocumentTypeLocally,
  splitDocumentImage,
  type DocumentTypeClassifier,
} from '../src/document-ingestion.js';
import { buildServer } from '../src/server.js';

let root: string;
let stagingDir: string;
let archiveDir: string;
let cacheDir: string;

async function makeDocumentSheet(): Promise<Buffer> {
  const photo = await sharp({
    create: { width: 360, height: 260, channels: 3, background: '#b52874' },
  })
    .composite([
      { input: Buffer.from('<svg width="360" height="260"><circle cx="80" cy="80" r="55" fill="#22aadd"/><rect x="160" y="60" width="150" height="150" fill="#e6c229"/></svg>') },
    ])
    .png()
    .toBuffer();
  const letter = await sharp({
    create: { width: 330, height: 440, channels: 3, background: '#f2ead8' },
  })
    .composite([
      { input: Buffer.from('<svg width="330" height="440"><path d="M30 80 Q130 30 280 85 M30 130 Q150 90 290 145 M35 190 Q160 150 275 205 M30 255 Q150 215 290 265" stroke="#4d453c" stroke-width="8" fill="none"/></svg>') },
    ])
    .png()
    .toBuffer();
  const article = await sharp({
    create: { width: 390, height: 470, channels: 3, background: '#f7f5ef' },
  })
    .composite([
      { input: Buffer.from('<svg width="390" height="470"><rect x="25" y="35" width="340" height="30" fill="#222"/><g stroke="#555" stroke-width="5"><path d="M25 100H365 M25 135H365 M25 170H365 M25 205H365 M25 240H365 M25 275H365 M25 310H365 M25 345H365 M25 380H365"/></g></svg>') },
    ])
    .png()
    .toBuffer();
  return sharp({
    create: { width: 1500, height: 1000, channels: 3, background: '#27333a' },
  })
    .composite([
      { input: photo, left: 90, top: 90 },
      { input: letter, left: 560, top: 80 },
      { input: article, left: 1030, top: 390 },
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kt-document-sheet-'));
  stagingDir = join(root, 'staging');
  archiveDir = join(root, 'archive');
  cacheDir = join(root, 'cache');
  await Promise.all([stagingDir, archiveDir, cacheDir].map((dir) => mkdir(dir)));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('document sheet splitting', () => {
  it('detects separated documents in reading order and writes full-size crops', async () => {
    const sourcePath = join(root, 'desk.jpg');
    await sharp(await makeDocumentSheet()).toFile(sourcePath);

    const regions = await detectDocumentRegions(sourcePath);
    expect(regions).toHaveLength(3);
    expect(regions[0]!.left).toBeLessThan(regions[1]!.left);
    expect(regions[2]!.top).toBeGreaterThan(regions[0]!.top);

    const cropDir = join(root, 'crops');
    await mkdir(cropDir);
    const crops = await splitDocumentImage(sourcePath, cropDir, 'family desk.JPG');
    expect(crops.map((crop) => crop.filename)).toEqual([
      'family-desk-document-01.jpg',
      'family-desk-document-02.jpg',
      'family-desk-document-03.jpg',
    ]);
    const metadata = await sharp(crops[1]!.path).metadata();
    expect(metadata.width).toBeGreaterThan(300);
    expect(metadata.height).toBeGreaterThan(400);
  });

  it('uses a conservative local photo-versus-document fallback', async () => {
    const colourful = await sharp({
      create: { width: 300, height: 200, channels: 3, background: '#d22f8a' },
    }).png().toBuffer();
    const paper = await sharp({
      create: { width: 300, height: 400, channels: 3, background: '#f4f0e6' },
    }).png().toBuffer();
    expect(await inferDocumentTypeLocally(colourful)).toBe('photo');
    expect(await inferDocumentTypeLocally(paper)).toBe('pdf');
  });

  it('validates and preserves vision classifications in image order', async () => {
    const classifier = createVisionDocumentTypeClassifier({
      async analyzeImages(images, prompt) {
        expect(images).toHaveLength(2);
        expect(prompt).toContain('Document purpose controls the choice');
        return '```json\n{"items":[{"index":2,"mediaType":"article"},{"index":1,"mediaType":"letter"}]}\n```';
      },
    });
    expect(await classifier.classify([Buffer.from('one'), Buffer.from('two')]))
      .toEqual(['letter', 'article']);
  });
});

describe('POST /api/document-sheets/ingest', () => {
  it('imports every crop with vision-selected types and removes temporary files', async () => {
    const db = openDb(':memory:');
    const classifier: DocumentTypeClassifier = {
      async classify(images) {
        expect(images).toHaveLength(3);
        return ['photo', 'letter', 'article'];
      },
    };
    const app = buildServer({
      db,
      stagingDir,
      archiveDir,
      cacheDir,
      engine: null,
      documentTypeClassifier: classifier,
    });
    const form = new FormData();
    form.append('file', await makeDocumentSheet(), {
      filename: 'desk-full.jpg',
      contentType: 'image/jpeg',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/document-sheets/ingest',
      payload: form.getBuffer(),
      headers: form.getHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      detectedCount: 3,
      typeDetection: 'vision',
      warning: null,
      results: [
        { path: 'desk-full-document-01.jpg', mediaType: 'photo', autoSelected: true },
        { path: 'desk-full-document-02.jpg', mediaType: 'letter', autoSelected: true },
        { path: 'desk-full-document-03.jpg', mediaType: 'article', autoSelected: true },
      ],
    });
    const rows = db.prepare('SELECT media_type, original_filename FROM items ORDER BY id').all();
    expect(rows).toEqual([
      { media_type: 'photo', original_filename: 'desk-full-document-01.jpg' },
      { media_type: 'letter', original_filename: 'desk-full-document-02.jpg' },
      { media_type: 'article', original_filename: 'desk-full-document-03.jpg' },
    ]);
    expect(await readdir(stagingDir)).toEqual([]);
  });

  it('falls back locally when no vision classifier is configured', async () => {
    const db = openDb(':memory:');
    const app = buildServer({ db, stagingDir, archiveDir, cacheDir, engine: null });
    const form = new FormData();
    form.append('file', await makeDocumentSheet(), {
      filename: 'desk.jpg',
      contentType: 'image/jpeg',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/document-sheets/ingest',
      payload: form.getBuffer(),
      headers: form.getHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      detectedCount: 3,
      typeDetection: 'local',
      warning: expect.stringContaining('AI type detection is unavailable'),
    });
  });

  it('returns a useful detection error and still cleans staging', async () => {
    const db = openDb(':memory:');
    const app = buildServer({ db, stagingDir, archiveDir, cacheDir, engine: null });
    const emptySurface = await sharp({
      create: { width: 900, height: 600, channels: 3, background: '#333333' },
    }).jpeg().toBuffer();
    const form = new FormData();
    form.append('file', emptySurface, { filename: 'empty-desk.jpg', contentType: 'image/jpeg' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/document-sheets/ingest',
      payload: form.getBuffer(),
      headers: form.getHeaders(),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toContain('No separate documents were detected');
    expect(await readdir(stagingDir)).toEqual([]);
  });
});
