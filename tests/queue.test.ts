import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db.js';
import { processPendingItems } from '../src/ai/queue.js';
import { createLlmVisionEngine } from '../src/ai/engine.js';
import type { VisionClient } from '../src/ai/transcriber.js';

const draftFields = {
  transcription_diplomatic: 'Dear Mabel, the har-\nvest is in. Yrs, [possibly Earl]',
  transcription_normalized: 'Dear Mabel, the harvest is in. Yours, Earl.',
  title: 'Harvest letter',
  description: 'A letter.',
  date: { start: '1943-01-01', end: null, precision: 'year' },
  names: ['Mabel'],
  documentType: 'personal letter',
};

const draftResponse = JSON.stringify(draftFields);

const verifiedResponse = JSON.stringify({
  ...draftFields,
  transcription_diplomatic: 'Dear Mabel, the har-\nvest is in. Yrs, Earl Hutchins',
  transcription_normalized: 'Dear Mabel, the harvest is in. Yours, Earl Hutchins.',
  names: ['Mabel', 'Earl Hutchins'],
  confidence: {
    overall: 'medium',
    summary: 'Signature legible on second look; one hyphenated word flagged.',
    flaggedSpans: [{ text: 'har-\nvest', reason: 'line-break hyphenation' }],
  },
});

function scriptedEngine(responses: (string | Error)[]) {
  let calls = 0;
  const client: VisionClient = {
    analyzeImages: async () => {
      calls++;
      const next = responses.shift();
      if (next === undefined) throw new Error('scripted client exhausted');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { engine: createLlmVisionEngine(client), callCount: () => calls };
}

function seedItem(db: any, hash: string) {
  return Number(
    db.prepare("INSERT INTO items (file_path, content_hash, media_type) VALUES ('/x.jpg', ?, 'letter')")
      .run(hash).lastInsertRowid
  );
}

const fakeResize = async () => Buffer.from('img');

describe('processPendingItems', () => {
  it('transcribes pending items, storing both transcriptions, confidence, and normalized dates', async () => {
    const db = openDb(':memory:');
    const id = seedItem(db, 'h1');
    const { engine, callCount } = scriptedEngine([draftResponse, verifiedResponse]);

    const result = await processPendingItems(db, engine, { resizeForAi: fakeResize });
    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(callCount()).toBe(2);

    const item: any = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    expect(item.status).toBe('transcribed');
    expect(item.title).toBe('Harvest letter');
    expect(item.transcription_diplomatic).toBe('Dear Mabel, the har-\nvest is in. Yrs, Earl Hutchins');
    expect(item.transcription_normalized).toBe('Dear Mabel, the harvest is in. Yours, Earl Hutchins.');
    expect(item.date_start).toBe('1943-01-01');
    expect(item.date_end).toBe('1943-12-31'); // year precision expanded
    expect(JSON.parse(item.ai_names)).toEqual(['Mabel', 'Earl Hutchins']);
    const confidence = JSON.parse(item.ai_confidence);
    expect(confidence.overall).toBe('medium');
    expect(confidence.flaggedSpans).toEqual([
      { text: 'har-\nvest', reason: 'line-break hyphenation' },
    ]);
    expect(item.ai_error).toBeNull();
  });

  it('leaves an item pending with nothing partial written when the second pass fails', async () => {
    const db = openDb(':memory:');
    const id = seedItem(db, 'h1');
    const { engine, callCount } = scriptedEngine([draftResponse, new Error('verify pass down')]);

    const result = await processPendingItems(db, engine, { resizeForAi: fakeResize });
    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(callCount()).toBe(2);

    const item: any = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    expect(item.status).toBe('pending');
    expect(item.ai_error).toMatch(/verify pass down/);
    expect(item.transcription_diplomatic).toBeNull();
    expect(item.transcription_normalized).toBeNull();
    expect(item.ai_confidence).toBeNull();
  });

  it('records errors and keeps failed items pending, continuing past them', async () => {
    const db = openDb(':memory:');
    seedItem(db, 'h1');
    seedItem(db, 'h2');
    // Item 1: pass 1 throws. Item 2: full draft + verify succeeds.
    const { engine } = scriptedEngine([new Error('rate limited'), draftResponse, verifiedResponse]);

    const result = await processPendingItems(db, engine, { resizeForAi: fakeResize });
    expect(result).toEqual({ processed: 1, failed: 1 });

    const rows: any[] = db.prepare('SELECT status, ai_error FROM items ORDER BY id').all();
    expect(rows[0].status).toBe('pending');
    expect(rows[0].ai_error).toMatch(/rate limited/);
    expect(rows[1].status).toBe('transcribed');
  });

  it('handles a non-Error throw without aborting the run, recording it as ai_error', async () => {
    const db = openDb(':memory:');
    seedItem(db, 'h1');
    const client: VisionClient = {
      analyzeImages: async () => {
        throw 'rate limited string';
      },
    };
    const engine = createLlmVisionEngine(client);

    const result = await processPendingItems(db, engine, { resizeForAi: fakeResize });
    expect(result).toEqual({ processed: 0, failed: 1 });

    const row: any = db.prepare('SELECT status, ai_error FROM items').get();
    expect(row.status).toBe('pending');
    expect(row.ai_error).toMatch(/rate limited string/);
  });

  it('does not touch reviewed or transcribed items', async () => {
    const db = openDb(':memory:');
    const id = seedItem(db, 'h1');
    db.prepare("UPDATE items SET status = 'reviewed' WHERE id = ?").run(id);
    const { engine, callCount } = scriptedEngine([]);
    const result = await processPendingItems(db, engine, { resizeForAi: fakeResize });
    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(callCount()).toBe(0);
  });
});
