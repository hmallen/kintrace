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
