import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db.js';
import { buildServer } from '../src/server.js';

let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof buildServer>;

beforeEach(() => {
  db = openDb(':memory:');
  app = buildServer({ db, archiveDir: '/tmp/na', cacheDir: '/tmp/na', stagingDir: '/tmp/na', engine: null });
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

  it('deletes a library item and its dependent links without deleting people', async () => {
    const itemId = seedItem('h-delete');
    const personId = Number(db.prepare("INSERT INTO people (name) VALUES ('Mabel')").run().lastInsertRowid);
    db.prepare("INSERT INTO item_people VALUES (?, ?, 'subject')").run(itemId, personId);
    db.prepare("INSERT INTO pages (item_id, page_index, file_path) VALUES (?, 0, '/page.jpg')").run(itemId);

    const response = await app.inject({ method: 'DELETE', url: `/api/items/${itemId}` });

    expect(response.statusCode).toBe(204);
    expect(db.prepare('SELECT * FROM items WHERE id = ?').get(itemId)).toBeUndefined();
    expect(db.prepare('SELECT * FROM item_people WHERE item_id = ?').all(itemId)).toEqual([]);
    expect(db.prepare('SELECT * FROM pages WHERE item_id = ?').all(itemId)).toEqual([]);
    expect(db.prepare('SELECT name FROM people WHERE id = ?').get(personId)).toEqual({ name: 'Mabel' });
    expect((await app.inject({ method: 'DELETE', url: `/api/items/${itemId}` })).statusCode).toBe(404);
  });

  it('removes one person role tag without removing another role', async () => {
    const itemId = seedItem('h-unlink');
    const personId = Number(db.prepare("INSERT INTO people (name) VALUES ('Mabel')").run().lastInsertRowid);
    db.prepare("INSERT INTO item_people VALUES (?, ?, 'subject')").run(itemId, personId);
    db.prepare("INSERT INTO item_people VALUES (?, ?, 'recipient')").run(itemId, personId);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/items/${itemId}/people/${personId}/recipient`,
    });

    expect(response.statusCode).toBe(204);
    expect(db.prepare('SELECT role FROM item_people WHERE item_id = ?').all(itemId))
      .toEqual([{ role: 'subject' }]);
    expect((await app.inject({
      method: 'DELETE', url: `/api/items/${itemId}/people/${personId}/recipient`,
    })).statusCode).toBe(404);
  });

  it('changes media type only while an item is pending', async () => {
    const pendingId = Number(db.prepare(
      "INSERT INTO items (file_path, content_hash, media_type, title) VALUES ('/queued.jpg', 'h-type-pending', 'photo', 'Queued item')"
    ).run().lastInsertRowid);
    const changed = await app.inject({
      method: 'PATCH', url: `/api/items/${pendingId}`, payload: { media_type: 'article' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().media_type).toBe('article');

    const transcribedId = seedItem('h-type-done');
    const rejected = await app.inject({
      method: 'PATCH',
      url: `/api/items/${transcribedId}`,
      payload: { media_type: 'pdf', title: 'Should not change' },
    });
    expect(rejected.statusCode).toBe(409);
    expect(db.prepare('SELECT media_type, title FROM items WHERE id = ?').get(transcribedId))
      .toEqual({ media_type: 'letter', title: 'A letter' });

    expect((await app.inject({
      method: 'PATCH', url: `/api/items/${pendingId}`, payload: { media_type: 'document' },
    })).statusCode).toBe(400);
  });

  it('merges duplicate people and preserves references and complementary details', async () => {
    const keepId = Number(db.prepare(
      "INSERT INTO people (name, birth_start, birth_end, birth_precision, notes) VALUES ('Mabel Smith', '1900-01-01', '1900-12-31', 'year', 'Family notes')"
    ).run().lastInsertRowid);
    const duplicateId = Number(db.prepare(
      "INSERT INTO people (name, death_start, death_end, death_precision, notes) VALUES ('Mabel Smith', '1980-01-01', '1980-12-31', 'year', 'GEDCOM notes')"
    ).run().lastInsertRowid);
    const relativeId = Number(db.prepare("INSERT INTO people (name) VALUES ('Earl Smith')").run().lastInsertRowid);
    const itemId = seedItem('h-merge');
    db.prepare("INSERT INTO item_people VALUES (?, ?, 'subject')").run(itemId, keepId);
    db.prepare("INSERT INTO item_people VALUES (?, ?, 'subject')").run(itemId, duplicateId);
    db.prepare("INSERT INTO item_people VALUES (?, ?, 'author')").run(itemId, duplicateId);
    const eventId = Number(db.prepare(
      "INSERT INTO events (title, person_id) VALUES ('Homecoming', ?)"
    ).run(duplicateId).lastInsertRowid);
    const importId = Number(db.prepare(
      "INSERT INTO gedcom_imports (original_filename, content_hash, archived_file_path, counts_json, warnings_json) VALUES ('tree.ged', 'ged-hash', '/tree.ged', '{}', '[]')"
    ).run().lastInsertRowid);
    db.prepare(
      "INSERT INTO gedcom_xrefs (gedcom_import_id, gedcom_xref, entity_type, entity_id) VALUES (?, '@I1@', 'person', ?)"
    ).run(importId, duplicateId);
    db.prepare(
      "INSERT INTO person_relationships (person_id, related_person_id, relationship) VALUES (?, ?, 'spouse')"
    ).run(keepId, relativeId);
    db.prepare(
      "INSERT INTO person_relationships (person_id, related_person_id, relationship) VALUES (?, ?, 'spouse')"
    ).run(duplicateId, relativeId);
    db.prepare(
      "INSERT INTO person_relationships (person_id, related_person_id, relationship) VALUES (?, ?, 'spouse')"
    ).run(duplicateId, keepId);

    const response = await app.inject({
      method: 'POST',
      url: '/api/people/merge',
      payload: { keepId, duplicateId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: keepId,
      name: 'Mabel Smith',
      notes: 'Family notes\n\nGEDCOM notes',
    });
    expect(db.prepare('SELECT * FROM people WHERE id = ?').get(duplicateId)).toBeUndefined();
    expect(db.prepare('SELECT birth_start, death_start FROM people WHERE id = ?').get(keepId))
      .toEqual({ birth_start: '1900-01-01', death_start: '1980-01-01' });
    expect(db.prepare('SELECT role FROM item_people WHERE item_id = ? ORDER BY role').all(itemId))
      .toEqual([{ role: 'author' }, { role: 'subject' }]);
    expect(db.prepare('SELECT person_id FROM events WHERE id = ?').get(eventId)).toEqual({ person_id: keepId });
    expect(db.prepare("SELECT entity_id FROM gedcom_xrefs WHERE gedcom_xref = '@I1@'").get())
      .toEqual({ entity_id: keepId });
    expect(db.prepare(
      'SELECT person_id, related_person_id, relationship FROM person_relationships ORDER BY id'
    ).all()).toEqual([{ person_id: keepId, related_person_id: relativeId, relationship: 'spouse' }]);
  });

  it('validates people merge ids and leaves both records intact on errors', async () => {
    const personId = Number(db.prepare("INSERT INTO people (name) VALUES ('Mabel')").run().lastInsertRowid);
    expect((await app.inject({
      method: 'POST', url: '/api/people/merge', payload: { keepId: personId, duplicateId: personId },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: '/api/people/merge', payload: { keepId: personId, duplicateId: 9999 },
    })).statusCode).toBe(404);
    expect(db.prepare('SELECT COUNT(*) AS count FROM people').get()).toEqual({ count: 1 });
  });

  it('returns 404 for missing items and 503 for queue without AI client', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/items/999' })).statusCode).toBe(404);
    const queue = await app.inject({ method: 'POST', url: '/api/queue/process' });
    expect(queue.statusCode).toBe(503);
    expect(queue.json()).toEqual({ error: 'AI transcription not configured' });
  });

  it('returns 503 with the provider-aware message when aiDisabledMessage is set', async () => {
    const message = 'AI transcription disabled: TRANSCRIBE_PROVIDER=openai but OPENAI_API_KEY is not set';
    const disabled = buildServer({
      db, archiveDir: '/tmp/na', cacheDir: '/tmp/na', stagingDir: '/tmp/na', engine: null, aiDisabledMessage: message,
    });
    const res = await disabled.inject({ method: 'POST', url: '/api/queue/process' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: message });
  });

  it('patches the two transcription fields independently and together', async () => {
    const id = seedItem('h-tr');
    const dip = await app.inject({
      method: 'PATCH', url: `/api/items/${id}`,
      payload: { transcription_diplomatic: 'Dear Mabel, the har-\nvest is in.' },
    });
    expect(dip.statusCode).toBe(200);
    let item: any = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    expect(item.transcription_diplomatic).toBe('Dear Mabel, the har-\nvest is in.');
    expect(item.transcription_normalized).toBeNull();

    const norm = await app.inject({
      method: 'PATCH', url: `/api/items/${id}`,
      payload: { transcription_normalized: 'Dear Mabel, the harvest is in.' },
    });
    expect(norm.statusCode).toBe(200);
    item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    expect(item.transcription_normalized).toBe('Dear Mabel, the harvest is in.');
    expect(item.transcription_diplomatic).toBe('Dear Mabel, the har-\nvest is in.');

    const both = await app.inject({
      method: 'PATCH', url: `/api/items/${id}`,
      payload: { transcription_diplomatic: 'D2', transcription_normalized: 'N2' },
    });
    expect(both.statusCode).toBe(200);
    item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    expect(item.transcription_diplomatic).toBe('D2');
    expect(item.transcription_normalized).toBe('N2');
  });

  it('rejects a PATCH body containing only ai_confidence (400)', async () => {
    const id = seedItem('h-conf-patch');
    const res = await app.inject({
      method: 'PATCH', url: `/api/items/${id}`,
      payload: { ai_confidence: { overall: 'high', summary: '', flaggedSpans: [] } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns parsed ai_confidence from GET and PATCH, with ai_names left as a raw JSON string', async () => {
    const confidence = {
      overall: 'medium',
      summary: 'Signature legible on second look.',
      flaggedSpans: [{ text: 'har-\nvest', reason: 'line-break hyphenation' }],
    };
    const id = seedItem('h-conf');
    db.prepare('UPDATE items SET ai_confidence = ?, ai_names = ? WHERE id = ?')
      .run(JSON.stringify(confidence), JSON.stringify(['Mabel']), id);

    const got = await app.inject({ method: 'GET', url: `/api/items/${id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json().ai_confidence).toEqual(confidence);
    expect(got.json().ai_names).toBe(JSON.stringify(['Mabel']));

    const patched = await app.inject({
      method: 'PATCH', url: `/api/items/${id}`, payload: { title: 'Retitled' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().ai_confidence).toEqual(confidence);
  });

  it('returns ai_confidence as null when unset and when the column holds unparseable JSON', async () => {
    const unset = seedItem('h-conf-null');
    const unsetRes = await app.inject({ method: 'GET', url: `/api/items/${unset}` });
    expect(unsetRes.statusCode).toBe(200);
    expect(unsetRes.json().ai_confidence).toBeNull();

    const broken = seedItem('h-conf-broken');
    db.prepare('UPDATE items SET ai_confidence = ? WHERE id = ?').run('{not json', broken);
    const brokenRes = await app.inject({ method: 'GET', url: `/api/items/${broken}` });
    expect(brokenRes.statusCode).toBe(200);
    expect(brokenRes.json().ai_confidence).toBeNull();
  });

  it('includes thumb_path in the items list for an item seeded with one', async () => {
    const id = Number(
      db.prepare(
        "INSERT INTO items (file_path, content_hash, media_type, title, status, thumb_path) VALUES ('/x.jpg', 'hthumb', 'letter', 'A letter', 'transcribed', '/cache/hthumb-thumb.jpg')"
      ).run().lastInsertRowid
    );
    const res = await app.inject({ method: 'GET', url: '/api/items?status=transcribed' });
    const found = res.json().find((i: any) => i.id === id);
    expect(found.thumb_path).toBe('/cache/hthumb-thumb.jpg');
  });

  it('rejects linking with an invalid role (400) and a missing person (404)', async () => {
    const id = seedItem('h-link');
    const badRole = await app.inject({
      method: 'POST', url: `/api/items/${id}/people`, payload: { personId: 1, role: 'friend' },
    });
    expect(badRole.statusCode).toBe(400);

    const missingPerson = await app.inject({
      method: 'POST', url: `/api/items/${id}/people`, payload: { personId: 999999, role: 'author' },
    });
    expect(missingPerson.statusCode).toBe(404);
  });

  it('rejects PATCH to reviewed when the item is still pending, applying no changes', async () => {
    const id = Number(
      db.prepare(
        "INSERT INTO items (file_path, content_hash, media_type, title, status) VALUES ('/x.jpg', 'h-pending', 'letter', 'Original title', 'pending')"
      ).run().lastInsertRowid
    );
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/items/${id}`,
      payload: { title: 'New title', status: 'reviewed' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'item not transcribed yet' });
    const item: any = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    expect(item.title).toBe('Original title');
    expect(item.status).toBe('pending');
  });

  it('rejects import with missing paths or a bad mediaType', async () => {
    const missingPaths = await app.inject({ method: 'POST', url: '/api/import', payload: { mediaType: 'photo' } });
    expect(missingPaths.statusCode).toBe(400);

    const badMediaType = await app.inject({
      method: 'POST', url: '/api/import', payload: { paths: ['/a.jpg'], mediaType: 'bogus' },
    });
    expect(badMediaType.statusCode).toBe(400);
  });

  it('returns 400 (not 500) for a PATCH with no body/content-type', async () => {
    const id = seedItem('h-nobody');
    const res = await app.inject({ method: 'PATCH', url: `/api/items/${id}` });
    expect(res.statusCode).toBe(400);
  });

  it('returns each item once from GET /api/items?personId= even when linked under two roles', async () => {
    const id = seedItem('h-dup');
    const personId = Number(db.prepare("INSERT INTO people (name) VALUES ('Dual Role')").run().lastInsertRowid);
    db.prepare("INSERT INTO item_people (item_id, person_id, role) VALUES (?, ?, 'author')").run(id, personId);
    db.prepare("INSERT INTO item_people (item_id, person_id, role) VALUES (?, ?, 'recipient')").run(id, personId);
    const res = await app.inject({ method: 'GET', url: `/api/items?personId=${personId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});
