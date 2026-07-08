# KinTrace Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the KinTrace backend: SQLite data layer, fuzzy dates, file import with dedupe + thumbnails, Claude-powered transcription queue, and a Fastify REST API.

**Architecture:** Single Node/TypeScript package. `better-sqlite3` for data, files copied into a managed archive folder, `sharp` for thumbnails, a resumable in-DB queue drives Claude API vision calls, Fastify exposes REST routes for the future React UI.

**Tech Stack:** Node 22, TypeScript (ESM), vitest, Fastify, better-sqlite3, sharp, zod, @anthropic-ai/sdk.

## Global Constraints

- ESM throughout (`"type": "module"`); TypeScript strict mode.
- Originals in the archive folder are never modified after import.
- All dates stored as ISO `YYYY-MM-DD` strings with precision `exact | month | year | decade | unknown`.
- Item status lifecycle is exactly `pending → transcribed → reviewed`.
- All AI responses validated with zod before touching the DB.
- Tests must not call the real Claude API — inject a fake client.
- Commit after every green test cycle.

## File Structure

```
package.json, tsconfig.json, vitest.config.ts
src/db.ts            — open DB, run schema migration
src/dates.ts         — FuzzyDate type + validation/range helpers
src/importer.ts      — hash, copy to archive, thumbnail, insert pending item
src/ai/transcriber.ts— prompt Claude with an image, parse structured JSON
src/ai/queue.ts      — process pending items, resumable, per-item error capture
src/server.ts        — Fastify app factory with REST routes
src/main.ts          — entry point: open DB, start server + queue
tests/*.test.ts      — one test file per module
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/main.ts`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: a repo where `npm test` runs vitest and `npm run dev` runs `src/main.ts` via tsx.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "kintrace",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install fastify better-sqlite3 sharp zod @anthropic-ai/sdk
npm install -D typescript tsx vitest @types/node @types/better-sqlite3
```

- [ ] **Step 3: Create tsconfig.json and vitest.config.ts**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node' } });
```

`.gitignore`:
```
node_modules/
data/
*.db
```

- [ ] **Step 4: Write smoke test and stub entry**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
describe('toolchain', () => {
  it('runs TypeScript tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

`src/main.ts`:
```ts
console.log('kintrace starting');
```

- [ ] **Step 5: Verify and commit**

Run: `npm test` → Expected: 1 passed. Run: `npm run typecheck` → Expected: no errors.

```bash
git add -A
git commit -m "chore: scaffold TypeScript project with vitest"
```

---

### Task 2: Database layer and schema

**Files:**
- Create: `src/db.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces: `openDb(path: string): Database.Database` — opens (or creates) the SQLite DB and applies the schema idempotently. Tables: `items`, `pages`, `people`, `item_people`, `events`.

- [ ] **Step 1: Write the failing test**

`tests/db.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db.test.ts` → Expected: FAIL (cannot find `../src/db.js`).

- [ ] **Step 3: Implement src/db.ts**

```ts
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
  transcription TEXT,
  ai_error TEXT,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db.test.ts` → Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/db.ts tests/db.test.ts
git commit -m "feat: SQLite schema and openDb"
```

---

### Task 3: Fuzzy date module

**Files:**
- Create: `src/dates.ts`
- Test: `tests/dates.test.ts`

**Interfaces:**
- Produces:
  - `type Precision = 'exact' | 'month' | 'year' | 'decade' | 'unknown'`
  - `interface FuzzyDate { start: string | null; end: string | null; precision: Precision }`
  - `normalizeFuzzyDate(input: { start?: string | null; end?: string | null; precision?: string | null }): FuzzyDate` — validates ISO format, expands single dates to ranges per precision (e.g. year `1943` → `1943-01-01`..`1943-12-31`, decade → 10-year span), falls back to `{ start: null, end: null, precision: 'unknown' }` on anything invalid.

- [ ] **Step 1: Write the failing test**

`tests/dates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeFuzzyDate } from '../src/dates.js';

describe('normalizeFuzzyDate', () => {
  it('passes exact dates through', () => {
    expect(normalizeFuzzyDate({ start: '1943-06-12', precision: 'exact' })).toEqual({
      start: '1943-06-12', end: '1943-06-12', precision: 'exact',
    });
  });
  it('expands a year to a full-year range', () => {
    expect(normalizeFuzzyDate({ start: '1943-01-01', precision: 'year' })).toEqual({
      start: '1943-01-01', end: '1943-12-31', precision: 'year',
    });
  });
  it('expands a month to a month range', () => {
    expect(normalizeFuzzyDate({ start: '1943-06-01', precision: 'month' })).toEqual({
      start: '1943-06-01', end: '1943-06-30', precision: 'month',
    });
  });
  it('expands a decade to a 10-year range', () => {
    expect(normalizeFuzzyDate({ start: '1940-01-01', precision: 'decade' })).toEqual({
      start: '1940-01-01', end: '1949-12-31', precision: 'decade',
    });
  });
  it('keeps an explicit end date', () => {
    expect(normalizeFuzzyDate({ start: '1943-01-01', end: '1945-12-31', precision: 'year' })).toEqual({
      start: '1943-01-01', end: '1945-12-31', precision: 'year',
    });
  });
  it('returns unknown for garbage', () => {
    expect(normalizeFuzzyDate({ start: 'circa the war', precision: 'exact' })).toEqual({
      start: null, end: null, precision: 'unknown',
    });
    expect(normalizeFuzzyDate({})).toEqual({ start: null, end: null, precision: 'unknown' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dates.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement src/dates.ts**

```ts
export type Precision = 'exact' | 'month' | 'year' | 'decade' | 'unknown';

export interface FuzzyDate {
  start: string | null;
  end: string | null;
  precision: Precision;
}

const PRECISIONS: Precision[] = ['exact', 'month', 'year', 'decade', 'unknown'];
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const UNKNOWN: FuzzyDate = { start: null, end: null, precision: 'unknown' };

function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeFuzzyDate(input: {
  start?: string | null;
  end?: string | null;
  precision?: string | null;
}): FuzzyDate {
  const precision = PRECISIONS.includes(input.precision as Precision)
    ? (input.precision as Precision)
    : 'unknown';
  const m = input.start ? ISO.exec(input.start) : null;
  if (!m || precision === 'unknown') return UNKNOWN;

  const [, y, mo] = m;
  const year = Number(y);
  const start = input.start!;
  if (input.end && ISO.test(input.end)) return { start, end: input.end, precision };

  switch (precision) {
    case 'exact':
      return { start, end: start, precision };
    case 'month':
      return { start, end: lastDayOfMonth(year, Number(mo)), precision };
    case 'year':
      return { start, end: `${year}-12-31`, precision };
    case 'decade': {
      const decadeStart = Math.floor(year / 10) * 10;
      return { start, end: `${decadeStart + 9}-12-31`, precision };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dates.test.ts` → Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/dates.ts tests/dates.test.ts
git commit -m "feat: fuzzy date normalization"
```

---

### Task 4: File importer

**Files:**
- Create: `src/importer.ts`
- Test: `tests/importer.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 2).
- Produces: `importFile(db: Database.Database, sourcePath: string, opts: { archiveDir: string; cacheDir: string; mediaType: MediaType }): Promise<{ itemId: number; duplicate: boolean }>` where `type MediaType = 'photo'|'letter'|'article'|'audio'|'video'|'pdf'`. Hashes the file (sha256), returns `{ duplicate: true }` with the existing id if the hash exists, otherwise copies the original into `archiveDir`, writes a 512px JPEG thumbnail into `cacheDir` (images only), and inserts a `pending` item.

- [ ] **Step 1: Write the failing test**

`tests/importer.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/importer.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement src/importer.ts**

```ts
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import type Database from 'better-sqlite3';

export type MediaType = 'photo' | 'letter' | 'article' | 'audio' | 'video' | 'pdf';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);

export interface ImportOptions {
  archiveDir: string;
  cacheDir: string;
  mediaType: MediaType;
}

export async function importFile(
  db: Database.Database,
  sourcePath: string,
  opts: ImportOptions
): Promise<{ itemId: number; duplicate: boolean }> {
  const bytes = await readFile(sourcePath);
  const hash = createHash('sha256').update(bytes).digest('hex');

  const existing = db
    .prepare('SELECT id FROM items WHERE content_hash = ?')
    .get(hash) as { id: number } | undefined;
  if (existing) return { itemId: existing.id, duplicate: true };

  await mkdir(opts.archiveDir, { recursive: true });
  await mkdir(opts.cacheDir, { recursive: true });

  const ext = extname(sourcePath).toLowerCase();
  const destPath = join(opts.archiveDir, `${hash.slice(0, 16)}-${basename(sourcePath)}`);
  await copyFile(sourcePath, destPath);

  if (IMAGE_EXTS.has(ext)) {
    await sharp(destPath)
      .resize({ width: 512, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(join(opts.cacheDir, `${hash.slice(0, 16)}-thumb.jpg`));
  }

  const info = db
    .prepare('INSERT INTO items (file_path, content_hash, media_type) VALUES (?, ?, ?)')
    .run(destPath, hash, opts.mediaType);
  return { itemId: Number(info.lastInsertRowid), duplicate: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/importer.test.ts` → Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/importer.ts tests/importer.test.ts
git commit -m "feat: file importer with dedupe and thumbnails"
```

---

### Task 5: AI transcriber

**Files:**
- Create: `src/ai/transcriber.ts`
- Test: `tests/transcriber.test.ts`

**Interfaces:**
- Consumes: nothing internal; takes an injected Claude-shaped client.
- Produces:
  - `interface AiSuggestion { transcription: string | null; title: string; description: string; date: { start: string | null; end: string | null; precision: string }; names: string[]; documentType: string }`
  - `interface VisionClient { analyzeImages(images: Buffer[], prompt: string): Promise<string> }` — the seam for testing and for the real Anthropic wrapper.
  - `transcribeItem(client: VisionClient, images: Buffer[], mediaType: string): Promise<AiSuggestion>` — builds a media-type-tailored prompt, calls the client, extracts the JSON object from the response text, validates with zod. Throws `Error('AI response invalid: ...')` on schema mismatch.
  - `createAnthropicVisionClient(apiKey: string): VisionClient` — real implementation using `@anthropic-ai/sdk` (model `claude-sonnet-5`, images as base64 JPEG blocks).

- [ ] **Step 1: Write the failing test**

`tests/transcriber.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { transcribeItem, type VisionClient } from '../src/ai/transcriber.js';

const goodResponse = JSON.stringify({
  transcription: 'Dear Mabel, the harvest is in...',
  title: 'Letter to Mabel about the harvest',
  description: 'A letter describing the 1943 harvest.',
  date: { start: '1943-09-01', end: null, precision: 'month' },
  names: ['Mabel Hutchins', 'Earl'],
  documentType: 'personal letter',
});

function fakeClient(response: string): VisionClient {
  return { analyzeImages: async () => response };
}

describe('transcribeItem', () => {
  it('parses a valid structured response', async () => {
    const result = await transcribeItem(fakeClient(goodResponse), [Buffer.from('img')], 'letter');
    expect(result.title).toBe('Letter to Mabel about the harvest');
    expect(result.names).toContain('Earl');
    expect(result.date.precision).toBe('month');
  });

  it('extracts JSON wrapped in prose or fences', async () => {
    const wrapped = 'Here is the analysis:\n```json\n' + goodResponse + '\n```';
    const result = await transcribeItem(fakeClient(wrapped), [Buffer.from('img')], 'letter');
    expect(result.title).toBe('Letter to Mabel about the harvest');
  });

  it('throws on schema-invalid responses', async () => {
    await expect(
      transcribeItem(fakeClient('{"nope": true}'), [Buffer.from('img')], 'letter')
    ).rejects.toThrow(/AI response invalid/);
  });

  it('tailors the prompt to the media type', async () => {
    let seenPrompt = '';
    const client: VisionClient = {
      analyzeImages: async (_imgs, prompt) => ((seenPrompt = prompt), goodResponse),
    };
    await transcribeItem(client, [Buffer.from('img')], 'letter');
    expect(seenPrompt).toMatch(/handwritten|letter/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/transcriber.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement src/ai/transcriber.ts**

```ts
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

export interface VisionClient {
  analyzeImages(images: Buffer[], prompt: string): Promise<string>;
}

const SuggestionSchema = z.object({
  transcription: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  date: z.object({
    start: z.string().nullable(),
    end: z.string().nullable(),
    precision: z.string(),
  }),
  names: z.array(z.string()),
  documentType: z.string(),
});

export type AiSuggestion = z.infer<typeof SuggestionSchema>;

const MEDIA_GUIDANCE: Record<string, string> = {
  letter:
    'This is a scan of a letter, likely handwritten (possibly cursive). Transcribe it faithfully, marking illegible words as [illegible].',
  article:
    'This is a scan of a newspaper or magazine article. Transcribe the full text including headline.',
  photo:
    'This is a photograph. Set transcription to null unless there is writing on it (captions, inscriptions on the back).',
  pdf: 'This is a scanned document. Transcribe all legible text.',
};

function buildPrompt(mediaType: string): string {
  const guidance = MEDIA_GUIDANCE[mediaType] ?? 'This is an archival family document.';
  return `You are helping organize a family history archive. ${guidance}

Analyze the image(s) and respond with ONLY a JSON object, no other text:
{
  "transcription": string | null,   // full transcription, or null if no text
  "title": string,                  // short descriptive title
  "description": string,            // 1-2 sentence description
  "date": { "start": "YYYY-MM-DD" | null, "end": "YYYY-MM-DD" | null, "precision": "exact" | "month" | "year" | "decade" | "unknown" },
  "names": string[],                // people named or depicted
  "documentType": string            // e.g. "personal letter", "portrait photograph"
}
If the date is uncertain, estimate a range and choose the honest precision.`;
}

export async function transcribeItem(
  client: VisionClient,
  images: Buffer[],
  mediaType: string
): Promise<AiSuggestion> {
  const text = await client.analyzeImages(images, buildPrompt(mediaType));
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI response invalid: no JSON object found');
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`AI response invalid: ${(e as Error).message}`);
  }
  const result = SuggestionSchema.safeParse(parsed);
  if (!result.success) throw new Error(`AI response invalid: ${result.error.message}`);
  return result.data;
}

export function createAnthropicVisionClient(apiKey: string): VisionClient {
  const anthropic = new Anthropic({ apiKey });
  return {
    async analyzeImages(images, prompt) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              ...images.map((img) => ({
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'image/jpeg' as const,
                  data: img.toString('base64'),
                },
              })),
              { type: 'text' as const, text: prompt },
            ],
          },
        ],
      });
      const block = response.content.find((b) => b.type === 'text');
      return block && block.type === 'text' ? block.text : '';
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/transcriber.test.ts` → Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/ai/transcriber.ts tests/transcriber.test.ts
git commit -m "feat: Claude vision transcriber with zod validation"
```

---

### Task 6: Transcription queue

**Files:**
- Create: `src/ai/queue.ts`
- Test: `tests/queue.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 2), `transcribeItem`/`VisionClient`/`AiSuggestion` (Task 5), `normalizeFuzzyDate` (Task 3).
- Produces: `processPendingItems(db: Database.Database, client: VisionClient, opts: { resizeForAi?: (path: string) => Promise<Buffer> }): Promise<{ processed: number; failed: number }>` — selects all `pending` items, loads their image(s) (item's own file, or ordered `pages` rows if any), calls `transcribeItem`, and on success writes `transcription`, `title`, `description`, normalized date fields, sets status `transcribed`, clears `ai_error`, and stores suggested names as JSON in a new `items.ai_names` column (added here via `ALTER TABLE`-safe migration in `db.ts`). On per-item failure: records the message in `ai_error`, leaves status `pending`, continues with remaining items. Default `resizeForAi` uses sharp to produce ≤1568px JPEG buffers.

- [ ] **Step 1: Add `ai_names` column to the schema**

In `src/db.ts`, inside the `items` CREATE TABLE, add after `ai_error TEXT,`:
```sql
  ai_names TEXT,
```
(New databases only — no migration needed pre-release.)

- [ ] **Step 2: Write the failing test**

`tests/queue.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db.js';
import { processPendingItems } from '../src/ai/queue.js';
import type { VisionClient } from '../src/ai/transcriber.js';

const good = JSON.stringify({
  transcription: 'Dear Mabel...',
  title: 'Harvest letter',
  description: 'A letter.',
  date: { start: '1943-01-01', end: null, precision: 'year' },
  names: ['Mabel'],
  documentType: 'personal letter',
});

function seedItem(db: any, hash: string) {
  return Number(
    db.prepare("INSERT INTO items (file_path, content_hash, media_type) VALUES ('/x.jpg', ?, 'letter')")
      .run(hash).lastInsertRowid
  );
}

const fakeResize = async () => Buffer.from('img');

describe('processPendingItems', () => {
  it('transcribes pending items and stores normalized dates', async () => {
    const db = openDb(':memory:');
    const id = seedItem(db, 'h1');
    const client: VisionClient = { analyzeImages: async () => good };

    const result = await processPendingItems(db, client, { resizeForAi: fakeResize });
    expect(result).toEqual({ processed: 1, failed: 0 });

    const item: any = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    expect(item.status).toBe('transcribed');
    expect(item.title).toBe('Harvest letter');
    expect(item.date_start).toBe('1943-01-01');
    expect(item.date_end).toBe('1943-12-31'); // year precision expanded
    expect(JSON.parse(item.ai_names)).toEqual(['Mabel']);
  });

  it('records errors and keeps failed items pending, continuing past them', async () => {
    const db = openDb(':memory:');
    seedItem(db, 'h1');
    seedItem(db, 'h2');
    let calls = 0;
    const client: VisionClient = {
      analyzeImages: async () => {
        calls++;
        if (calls === 1) throw new Error('rate limited');
        return good;
      },
    };

    const result = await processPendingItems(db, client, { resizeForAi: fakeResize });
    expect(result).toEqual({ processed: 1, failed: 1 });

    const rows: any[] = db.prepare('SELECT status, ai_error FROM items ORDER BY id').all();
    expect(rows[0].status).toBe('pending');
    expect(rows[0].ai_error).toMatch(/rate limited/);
    expect(rows[1].status).toBe('transcribed');
  });

  it('does not touch reviewed or transcribed items', async () => {
    const db = openDb(':memory:');
    const id = seedItem(db, 'h1');
    db.prepare("UPDATE items SET status = 'reviewed' WHERE id = ?").run(id);
    const client: VisionClient = { analyzeImages: async () => good };
    const result = await processPendingItems(db, client, { resizeForAi: fakeResize });
    expect(result).toEqual({ processed: 0, failed: 0 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/queue.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 4: Implement src/ai/queue.ts**

```ts
import sharp from 'sharp';
import type Database from 'better-sqlite3';
import { transcribeItem, type VisionClient } from './transcriber.js';
import { normalizeFuzzyDate } from '../dates.js';

async function defaultResize(path: string): Promise<Buffer> {
  return sharp(path).resize({ width: 1568, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

export async function processPendingItems(
  db: Database.Database,
  client: VisionClient,
  opts: { resizeForAi?: (path: string) => Promise<Buffer> } = {}
): Promise<{ processed: number; failed: number }> {
  const resize = opts.resizeForAi ?? defaultResize;
  const pending = db
    .prepare("SELECT id, file_path, media_type FROM items WHERE status = 'pending' ORDER BY id")
    .all() as { id: number; file_path: string; media_type: string }[];

  let processed = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const pages = db
        .prepare('SELECT file_path FROM pages WHERE item_id = ? ORDER BY page_index')
        .all(item.id) as { file_path: string }[];
      const paths = pages.length > 0 ? pages.map((p) => p.file_path) : [item.file_path];
      const images = await Promise.all(paths.map(resize));

      const s = await transcribeItem(client, images, item.media_type);
      const date = normalizeFuzzyDate(s.date);

      db.prepare(
        `UPDATE items SET transcription = ?, title = ?, description = ?,
           date_start = ?, date_end = ?, date_precision = ?,
           ai_names = ?, ai_error = NULL, status = 'transcribed'
         WHERE id = ?`
      ).run(
        s.transcription, s.title, s.description,
        date.start, date.end, date.precision,
        JSON.stringify(s.names), item.id
      );
      processed++;
    } catch (e) {
      db.prepare('UPDATE items SET ai_error = ? WHERE id = ?').run((e as Error).message, item.id);
      failed++;
    }
  }
  return { processed, failed };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run` → Expected: all tests pass (including earlier suites).

- [ ] **Step 6: Commit**

```bash
git add src/ai/queue.ts src/db.ts tests/queue.test.ts
git commit -m "feat: resumable transcription queue with per-item error capture"
```

---

### Task 7: REST API

**Files:**
- Create: `src/server.ts`
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 2), `importFile` (Task 4), `processPendingItems` (Task 6), `normalizeFuzzyDate` (Task 3).
- Produces: `buildServer(deps: { db: Database.Database; archiveDir: string; cacheDir: string; client: VisionClient | null }): FastifyInstance` with routes:
  - `GET /api/items?status=&personId=` — list items (id, title, media_type, dates, status, thumbnail name).
  - `GET /api/items/:id` — full item incl. transcription, ai_names, linked people.
  - `PATCH /api/items/:id` — update title/description/transcription/date (normalized) and optionally set `status: 'reviewed'`.
  - `POST /api/items/:id/people` — body `{ personId, role }`, links a person.
  - `GET /api/people` / `POST /api/people` — list / create (`{ name, notes? }`).
  - `POST /api/import` — body `{ paths: string[], mediaType }`, imports each; returns per-file results.
  - `POST /api/queue/process` — runs `processPendingItems` once; 503 if no AI client configured.

- [ ] **Step 1: Write the failing test**

`tests/server.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db.js';
import { buildServer } from '../src/server.js';

let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof buildServer>;

beforeEach(() => {
  db = openDb(':memory:');
  app = buildServer({ db, archiveDir: '/tmp/na', cacheDir: '/tmp/na', client: null });
});

function seedItem(hash = 'h1'): number {
  return Number(
    db.prepare("INSERT INTO items (file_path, content_hash, media_type, title, status) VALUES ('/x.jpg', ?, 'letter', 'A letter', 'transcribed')")
      .run(hash).lastInsertRowid
  );
}

describe('REST API', () => {
  it('lists items with status filter', async () => {
    seedItem('h1');
    const res = await app.inject({ method: 'GET', url: '/api/items?status=transcribed' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    const none = await app.inject({ method: 'GET', url: '/api/items?status=reviewed' });
    expect(none.json()).toHaveLength(0);
  });

  it('gets a single item with linked people', async () => {
    const id = seedItem();
    const personId = Number(db.prepare("INSERT INTO people (name) VALUES ('Mabel')").run().lastInsertRowid);
    db.prepare("INSERT INTO item_people (item_id, person_id, role) VALUES (?, ?, 'recipient')").run(id, personId);
    const res = await app.inject({ method: 'GET', url: `/api/items/${id}` });
    expect(res.json().people).toEqual([{ id: personId, name: 'Mabel', role: 'recipient' }]);
  });

  it('patches an item, normalizing the date, and can mark reviewed', async () => {
    const id = seedItem();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/items/${id}`,
      payload: { title: 'Harvest letter', date: { start: '1943-01-01', precision: 'year' }, status: 'reviewed' },
    });
    expect(res.statusCode).toBe(200);
    const item: any = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    expect(item.title).toBe('Harvest letter');
    expect(item.date_end).toBe('1943-12-31');
    expect(item.status).toBe('reviewed');
  });

  it('creates and lists people, and links them to items', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/people', payload: { name: 'Earl' } });
    expect(created.statusCode).toBe(201);
    const personId = created.json().id;
    const id = seedItem();
    const link = await app.inject({
      method: 'POST', url: `/api/items/${id}/people`, payload: { personId, role: 'author' },
    });
    expect(link.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/api/people' });
    expect(list.json()).toHaveLength(1);
  });

  it('returns 404 for missing items and 503 for queue without AI client', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/items/999' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/queue/process' })).statusCode).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement src/server.ts**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { importFile, type MediaType } from './importer.js';
import { processPendingItems } from './ai/queue.js';
import { normalizeFuzzyDate } from './dates.js';
import type { VisionClient } from './ai/transcriber.js';

export interface ServerDeps {
  db: Database.Database;
  archiveDir: string;
  cacheDir: string;
  client: VisionClient | null;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { db } = deps;
  const app = Fastify();

  app.get('/api/items', (req) => {
    const { status, personId } = req.query as { status?: string; personId?: string };
    let sql =
      'SELECT i.id, i.title, i.media_type, i.date_start, i.date_end, i.date_precision, i.status, i.content_hash FROM items i';
    const where: string[] = [];
    const params: unknown[] = [];
    if (personId) {
      sql += ' JOIN item_people ip ON ip.item_id = i.id';
      where.push('ip.person_id = ?');
      params.push(Number(personId));
    }
    if (status) {
      where.push('i.status = ?');
      params.push(status);
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY i.date_start IS NULL, i.date_start';
    return db.prepare(sql).all(...params);
  });

  app.get('/api/items/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!item) return reply.code(404).send({ error: 'not found' });
    const people = db
      .prepare(
        'SELECT p.id, p.name, ip.role FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ?'
      )
      .all(id);
    return { ...item, people };
  });

  app.patch('/api/items/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const item = db.prepare('SELECT id FROM items WHERE id = ?').get(id);
    if (!item) return reply.code(404).send({ error: 'not found' });
    const body = req.body as {
      title?: string; description?: string; transcription?: string;
      date?: { start?: string | null; end?: string | null; precision?: string };
      status?: 'reviewed';
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const field of ['title', 'description', 'transcription'] as const) {
      if (body[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(body[field]);
      }
    }
    if (body.date) {
      const d = normalizeFuzzyDate(body.date);
      sets.push('date_start = ?', 'date_end = ?', 'date_precision = ?');
      params.push(d.start, d.end, d.precision);
    }
    if (body.status === 'reviewed') {
      sets.push("status = 'reviewed'");
    }
    if (sets.length) {
      db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    }
    return db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  });

  app.post('/api/items/:id/people', (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { personId, role } = req.body as { personId: number; role: string };
    db.prepare('INSERT OR IGNORE INTO item_people (item_id, person_id, role) VALUES (?, ?, ?)')
      .run(id, personId, role);
    reply.code(204).send();
  });

  app.get('/api/people', () => db.prepare('SELECT * FROM people ORDER BY name').all());

  app.post('/api/people', (req, reply) => {
    const { name, notes } = req.body as { name: string; notes?: string };
    if (!name) return reply.code(400).send({ error: 'name required' });
    const info = db.prepare('INSERT INTO people (name, notes) VALUES (?, ?)').run(name, notes ?? null);
    reply.code(201).send({ id: Number(info.lastInsertRowid), name });
  });

  app.post('/api/import', async (req) => {
    const { paths, mediaType } = req.body as { paths: string[]; mediaType: MediaType };
    const results = [];
    for (const p of paths) {
      try {
        const r = await importFile(deps.db, p, {
          archiveDir: deps.archiveDir,
          cacheDir: deps.cacheDir,
          mediaType,
        });
        results.push({ path: p, ...r });
      } catch (e) {
        results.push({ path: p, error: (e as Error).message });
      }
    }
    return results;
  });

  app.post('/api/queue/process', async (_req, reply) => {
    if (!deps.client) return reply.code(503).send({ error: 'AI client not configured (set ANTHROPIC_API_KEY)' });
    return processPendingItems(deps.db, deps.client);
  });

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server.test.ts` → Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat: Fastify REST API for items, people, import, queue"
```

---

### Task 8: Entry point wiring

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `npm run dev` starts a working server on port 3271 with data under `./data/`.

- [ ] **Step 1: Implement src/main.ts**

```ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db.js';
import { buildServer } from './server.js';
import { createAnthropicVisionClient } from './ai/transcriber.js';

const dataDir = process.env.KINTRACE_DATA ?? join(process.cwd(), 'data');
const archiveDir = join(dataDir, 'archive');
const cacheDir = join(dataDir, 'cache');
mkdirSync(archiveDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

const db = openDb(join(dataDir, 'kintrace.db'));
const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? createAnthropicVisionClient(apiKey) : null;
if (!client) console.warn('ANTHROPIC_API_KEY not set — AI transcription disabled');

const app = buildServer({ db, archiveDir, cacheDir, client });
const port = Number(process.env.PORT ?? 3271);
app.listen({ port, host: '127.0.0.1' }).then(() => {
  console.log(`KinTrace API on http://127.0.0.1:${port}`);
});
```

- [ ] **Step 2: Verify end-to-end manually**

Run: `npm run dev` (in background), then:
```bash
curl -s http://127.0.0.1:3271/api/people
```
Expected: `[]`. Then create a person and list again:
```bash
curl -s -X POST http://127.0.0.1:3271/api/people -H 'content-type: application/json' -d '{"name":"Test Person"}'
curl -s http://127.0.0.1:3271/api/people
```
Expected: created id echoed, then a one-element list. Stop the server.

- [ ] **Step 3: Full test + typecheck pass**

Run: `npm test && npm run typecheck` → Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire entry point — db, dirs, AI client, server"
```
