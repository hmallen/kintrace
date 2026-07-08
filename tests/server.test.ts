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
