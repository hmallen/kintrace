import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db.js';
import { buildServer } from '../src/server.js';
import {
  ItemSummarySchema,
  ItemDetailSchema,
  PersonSchema,
  CreatePersonResultSchema,
  TimelineStoryStateSchema,
} from '../shared/api.js';

let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof buildServer>;

beforeEach(() => {
  db = openDb(':memory:');
  app = buildServer({ db, archiveDir: '/tmp/na', cacheDir: '/tmp/na', stagingDir: '/tmp/na', engine: null });
});

function seedItem(hash = 'h1', status = 'transcribed'): number {
  return Number(
    db.prepare(
      "INSERT INTO items (file_path, content_hash, media_type, title, status) VALUES ('/x.jpg', ?, 'letter', 'A letter', ?)"
    ).run(hash, status).lastInsertRowid
  );
}

describe('shared wire contract', () => {
  it('GET /api/items list parses as ItemSummary[]', async () => {
    seedItem();
    const res = await app.inject({ method: 'GET', url: '/api/items' });
    expect(res.statusCode).toBe(200);
    const parsed = ItemSummarySchema.array().parse(res.json());
    expect(parsed).toHaveLength(1);
  });

  it('GET /api/timeline/story parses as TimelineStoryState', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/timeline/story' });
    expect(res.statusCode).toBe(200);
    const parsed = TimelineStoryStateSchema.parse(res.json());
    expect(parsed.story).toBeNull();
    expect(parsed.unavailableReason).toBe('openai_not_configured');
  });

  it('GET /api/items/:id parses as ItemDetail', async () => {
    const id = seedItem('h-detail');
    const confidence = {
      overall: 'medium',
      summary: 'Signature legible on second look.',
      flaggedSpans: [{ text: 'har-\nvest', reason: 'line-break hyphenation' }],
    };
    db.prepare('UPDATE items SET ai_confidence = ?, ai_names = ? WHERE id = ?')
      .run(JSON.stringify(confidence), JSON.stringify(['Mabel']), id);
    const personId = Number(db.prepare("INSERT INTO people (name) VALUES ('Mabel')").run().lastInsertRowid);
    db.prepare("INSERT INTO item_people (item_id, person_id, role) VALUES (?, ?, 'recipient')").run(id, personId);

    const res = await app.inject({ method: 'GET', url: `/api/items/${id}` });
    expect(res.statusCode).toBe(200);
    const parsed = ItemDetailSchema.parse(res.json());
    expect(parsed.ai_confidence).not.toBeNull();
    expect(parsed.ai_confidence!.overall).toBe('medium');
    expect(typeof parsed.ai_names).toBe('string');
    expect(parsed.people).toEqual([{ id: personId, name: 'Mabel', role: 'recipient' }]);
  });

  it('GET /api/items/:id with null AI fields parses', async () => {
    const id = seedItem('h-null', 'pending');
    const res = await app.inject({ method: 'GET', url: `/api/items/${id}` });
    expect(res.statusCode).toBe(200);
    const parsed = ItemDetailSchema.parse(res.json());
    expect(parsed.ai_confidence).toBeNull();
    expect(parsed.transcription_diplomatic).toBeNull();
  });

  it('GET /api/people parses as Person[]', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/people', payload: { name: 'Earl' } });
    expect(created.statusCode).toBe(201);
    const res = await app.inject({ method: 'GET', url: '/api/people' });
    expect(res.statusCode).toBe(200);
    const parsed = PersonSchema.array().parse(res.json());
    expect(parsed).toEqual([{ id: created.json().id, name: 'Earl', notes: null }]);
  });

  it('POST /api/people result parses as CreatePersonResult', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/people', payload: { name: 'Earl' } });
    expect(res.statusCode).toBe(201);
    const parsed = CreatePersonResultSchema.parse(res.json());
    expect(parsed.name).toBe('Earl');
  });

  it('PATCH result parses as ItemDetail', async () => {
    const id = seedItem('h-patch');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/items/${id}`,
      payload: { title: 'Retitled' },
    });
    expect(res.statusCode).toBe(200);
    const parsed = ItemDetailSchema.parse(res.json());
    expect(parsed.title).toBe('Retitled');
  });
});
