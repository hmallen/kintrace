import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { buildServer } from '../src/server.js';

let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof buildServer>;
let root: string;

function insertItem(
  originalFilename: string,
  options: { title?: string; transcription?: string } = {},
): number {
  return Number(db.prepare(`
    INSERT INTO items (
      file_path, content_hash, media_type, original_filename, title, transcription_normalized
    ) VALUES (?, ?, 'photo', ?, ?, ?)
  `).run(
    join(root, originalFilename),
    `${originalFilename}-${Math.random()}`,
    originalFilename,
    options.title ?? null,
    options.transcription ?? null,
  ).lastInsertRowid);
}

beforeEach(async () => {
  db = openDb(':memory:');
  root = await mkdtemp(join(tmpdir(), 'kt-groups-'));
  app = buildServer({
    db,
    archiveDir: join(root, 'archive'),
    cacheDir: join(root, 'cache'),
    stagingDir: join(root, 'staging'),
    engine: null,
  });
});

afterEach(async () => {
  await app.close();
  db.close();
  await rm(root, { recursive: true, force: true });
});

describe('item groups', () => {
  it('creates a group and includes all views in item detail', async () => {
    const first = insertItem('letter-front.jpg', { title: 'Scottish Rite certificate' });
    const second = insertItem('letter-detail.jpg', { title: 'Scottish Rite Certificate' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/item-groups',
      payload: { itemIds: [first, second], label: 'Grandma letter' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      label: 'Grandma letter',
      items: [
        { id: first, title: 'Scottish Rite certificate' },
        { id: second, title: 'Scottish Rite Certificate' },
      ],
    });

    const detail = await app.inject({ method: 'GET', url: `/api/items/${first}` });
    expect(detail.json().group).toMatchObject({
      label: 'Grandma letter',
      items: [{ id: first }, { id: second }],
    });
  });

  it('lists groups for the library view', async () => {
    const first = insertItem('front.jpg', { title: 'Front' });
    const second = insertItem('back.jpg', { title: 'Back' });
    await app.inject({
      method: 'POST', url: '/api/item-groups', payload: { itemIds: [first, second], label: 'Certificate' },
    });

    const response = await app.inject({ method: 'GET', url: '/api/item-groups' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({ label: 'Certificate', items: [{ id: first, title: 'Front', media_type: 'photo', date_start: null, date_end: null, date_precision: 'unknown', status: 'pending', content_hash: expect.any(String), thumb_path: null }, { id: second, title: 'Back', media_type: 'photo', date_start: null, date_end: null, date_precision: 'unknown', status: 'pending', content_hash: expect.any(String), thumb_path: null }] }),
    ]);
  });

  it('lists people for library grouping and links a full subgroup to a person', async () => {
    const first = insertItem('front.jpg', { title: 'Front' });
    const second = insertItem('back.jpg', { title: 'Back' });
    const personId = Number(
      db.prepare("INSERT INTO people (name) VALUES ('Mabel Marshall')").run().lastInsertRowid,
    );
    const group = await app.inject({
      method: 'POST', url: '/api/item-groups', payload: { itemIds: [first, second], label: 'Diploma' },
    });

    expect((await app.inject({ method: 'GET', url: '/api/library/people' })).json()).toEqual([
      { id: personId, name: 'Mabel Marshall', itemIds: [] },
    ]);

    const linked = await app.inject({
      method: 'POST',
      url: `/api/item-groups/${group.json().id}/people`,
      payload: { personId, role: 'subject' },
    });

    expect(linked.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/library/people' })).json()).toEqual([
      { id: personId, name: 'Mabel Marshall', itemIds: [first, second] },
    ]);
    expect(db.prepare(
      'SELECT item_id, role FROM item_people WHERE person_id = ? ORDER BY item_id',
    ).all(personId)).toEqual([
      { item_id: first, role: 'subject' },
      { item_id: second, role: 'subject' },
    ]);
  });

  it('keeps item titles independent through grouping, editing, and removal', async () => {
    const first = insertItem('letter-front.jpg', { title: 'Original title' });
    const second = insertItem('letter-detail.jpg', { title: 'Other title' });
    const group = await app.inject({
      method: 'POST', url: '/api/item-groups', payload: { itemIds: [first, second] },
    });
    expect(group.json().items.map((item: { title: string }) => item.title))
      .toEqual(['Original title', 'Other title']);

    const updated = await app.inject({
      method: 'PATCH', url: `/api/items/${second}`, payload: { title: 'Edited second title' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().group.items.map((item: { title: string }) => item.title))
      .toEqual(['Original title', 'Edited second title']);
    expect((await app.inject({ method: 'GET', url: `/api/items/${first}` })).json().title)
      .toBe('Original title');

    await app.inject({
      method: 'DELETE', url: `/api/item-groups/${group.json().id}/items/${second}`,
    });
    expect((await app.inject({ method: 'GET', url: `/api/items/${second}` })).json().title)
      .toBe('Edited second title');
  });

  it('renames a group without changing any item title', async () => {
    const first = insertItem('letter-front.jpg', { title: 'Front view' });
    const second = insertItem('letter-detail.jpg', { title: 'Detail view' });
    const created = await app.inject({
      method: 'POST', url: '/api/item-groups', payload: { itemIds: [first, second] },
    });

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/item-groups/${created.json().id}`,
      payload: { label: 'Marshall certificate' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({
      label: 'Marshall certificate',
      items: [{ title: 'Front view' }, { title: 'Detail view' }],
    });
  });

  it('merges complete groups when a view from each is grouped together', async () => {
    const ids = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'].map((name) => insertItem(name));
    const first = await app.inject({
      method: 'POST', url: '/api/item-groups', payload: { itemIds: ids.slice(0, 2) },
    });
    const second = await app.inject({
      method: 'POST', url: '/api/item-groups', payload: { itemIds: ids.slice(2) },
    });
    const secondGroupId = second.json().id;

    const merged = await app.inject({
      method: 'POST', url: '/api/item-groups', payload: { itemIds: [ids[0], ids[2]] },
    });
    expect(merged.json().items.map((item: { id: number }) => item.id)).toEqual(ids);
    expect((await app.inject({ method: 'GET', url: `/api/item-groups/${secondGroupId}` })).statusCode).toBe(404);
    expect(merged.json().id).toBe(first.json().id);
  });

  it('preserves the drop-target group and label when adding another group', async () => {
    const ids = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'].map((name) => insertItem(name));
    const source = await app.inject({
      method: 'POST', url: '/api/item-groups', payload: { itemIds: ids.slice(0, 2), label: 'Source' },
    });
    const target = await app.inject({
      method: 'POST', url: '/api/item-groups', payload: { itemIds: ids.slice(2), label: 'Target' },
    });

    const moved = await app.inject({
      method: 'POST',
      url: `/api/item-groups/${target.json().id}/items`,
      payload: { itemId: ids[0] },
    });

    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({
      id: target.json().id,
      label: 'Target',
      items: ids.slice(2).map((id) => ({ id })).concat(ids.slice(0, 2).map((id) => ({ id }))),
    });
    expect((await app.inject({ method: 'GET', url: `/api/item-groups/${source.json().id}` })).statusCode)
      .toBe(404);
  });

  it('removes a view and dissolves a two-item group', async () => {
    const first = insertItem('one.jpg');
    const second = insertItem('two.jpg');
    const group = await app.inject({
      method: 'POST', url: '/api/item-groups', payload: { itemIds: [first, second] },
    });
    const groupId = group.json().id;

    const removed = await app.inject({
      method: 'DELETE', url: `/api/item-groups/${groupId}/items/${first}`,
    });
    expect(removed.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/item-groups/${groupId}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/items/${second}` })).json().group).toBeNull();
  });

  it('dissolves the group when deleting one of its two items', async () => {
    const first = insertItem('one.jpg');
    const second = insertItem('two.jpg');
    const group = await app.inject({
      method: 'POST', url: '/api/item-groups', payload: { itemIds: [first, second] },
    });

    expect((await app.inject({ method: 'DELETE', url: `/api/items/${first}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/item-groups/${group.json().id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/items/${second}` })).json().group).toBeNull();
  });

  it('suggests conservative filename and transcription matches without grouping them', async () => {
    const text = 'Dear Alice, we arrived safely and will visit the family tomorrow morning.';
    const source = insertItem('grandma-letter-front.jpg', { title: 'Letter from Grandma', transcription: text });
    const likely = insertItem('grandma-letter-detail.jpg', { title: 'Letter from Grandma', transcription: text });
    insertItem('IMG-1002.jpg');

    const response = await app.inject({
      method: 'GET', url: `/api/items/${source}/group-suggestions`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{
      item: expect.objectContaining({ id: likely }),
      confidence: 'likely',
      reasons: ['filename', 'title', 'transcription'],
    }]);
    expect((await app.inject({ method: 'GET', url: `/api/items/${source}` })).json().group).toBeNull();
  });

  it('suggests a near-identical OCR title only when date and media classification also match', async () => {
    const source = insertItem('PXL-1.jpg', {
      title: 'Scottish Rite 32nd Degree certificate for Hudson Boatner Marshall',
    });
    db.prepare(`
      UPDATE items SET date_start = '1922-10-26', date_end = '1922-10-26', date_precision = 'exact'
      WHERE id = ?
    `).run(source);
    const ocrVariant = insertItem('PXL-2.jpg', {
      title: 'Scottish Rite 32nd Degree certificate for Hudson Booher Marshall',
    });
    const unrelated = insertItem('PXL-3.jpg', {
      title: 'Shriners membership certificate for Hudson Boatner Marshall',
    });
    db.prepare(`
      UPDATE items SET date_start = '1922-10-26', date_end = '1922-10-26', date_precision = 'exact'
      WHERE id IN (?, ?)
    `).run(ocrVariant, unrelated);

    const response = await app.inject({
      method: 'GET', url: `/api/items/${source}/group-suggestions`,
    });
    expect(response.json()).toEqual([{
      item: expect.objectContaining({ id: ocrVariant }),
      confidence: 'possible',
      reasons: ['title'],
    }]);
  });

  it('rejects invalid groups and missing items', async () => {
    const item = insertItem('one.jpg');
    const oneItem = await app.inject({
      method: 'POST', url: '/api/item-groups', payload: { itemIds: [item] },
    });
    expect(oneItem.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'POST', url: '/api/item-groups', payload: { itemIds: [item, 999] },
    });
    expect(missing.statusCode).toBe(404);
  });
});
