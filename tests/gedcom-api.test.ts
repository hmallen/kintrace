import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import FormData from 'form-data';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { buildServer } from '../src/server.js';

let dir: string;
let db: ReturnType<typeof openDb>;
let app: ReturnType<typeof buildServer>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kt-gedcom-api-'));
  db = openDb(':memory:');
  app = buildServer({
    db,
    archiveDir: join(dir, 'media'),
    cacheDir: join(dir, 'cache'),
    stagingDir: join(dir, 'staging'),
    gedcomArchiveDir: join(dir, 'gedcom'),
    gedcomMaxBytes: 128,
    engine: null,
  });
});

function formWithFile(filename: string, content: Buffer | string): FormData {
  const form = new FormData();
  form.append('file', content, { filename });
  return form;
}

describe('GEDCOM API', () => {
  it('queues one GEDCOM upload and only exposes records after review', async () => {
    const form = formWithFile('family.ged', [
      '0 HEAD',
      '1 CHAR UTF-8',
      '0 @I1@ INDI',
      '1 NAME John /Smith/',
      '1 BIRT',
      '2 DATE 1901',
    ].join('\n'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/gedcom/import',
      payload: form,
      headers: form.getHeaders(),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      duplicate: false,
      counts: {
        peopleQueued: 1,
        relationshipsQueued: 0,
        eventsQueued: 1,
        warnings: 0,
      },
      warnings: [],
    });
    expect((await app.inject({ method: 'GET', url: '/api/people' })).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/events' })).json()).toEqual([]);

    const queue = (await app.inject({ method: 'GET', url: '/api/gedcom/review' })).json();
    expect(queue.groups.map((group: { group: string; items: unknown[] }) => [group.group, group.items.length])).toEqual([
      ['people', 1],
      ['relationships', 0],
      ['events', 1],
    ]);

    const peopleAccepted = await app.inject({
      method: 'POST',
      url: '/api/gedcom/review/groups/people/accept',
    });
    expect(peopleAccepted.statusCode).toBe(200);
    const eventsAccepted = await app.inject({
      method: 'POST',
      url: '/api/gedcom/review/groups/events/accept',
    });
    expect(eventsAccepted.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/people' })).json()).toMatchObject([
      { name: 'John Smith' },
    ]);
    expect((await app.inject({ method: 'GET', url: '/api/events' })).json()).toMatchObject([
      { title: 'Birth of John Smith', date_start: '1901-01-01', source_type: 'gedcom' },
    ]);
  });

  it('requires referenced people before accepting dependent records and supports rejection', async () => {
    const form = formWithFile('family.ged', [
      '0 HEAD',
      '1 CHAR UTF-8',
      '0 @I1@ INDI',
      '1 NAME John /Smith/',
      '1 BIRT',
      '2 DATE 1901',
    ].join('\n'));
    await app.inject({
      method: 'POST',
      url: '/api/gedcom/import',
      payload: form,
      headers: form.getHeaders(),
    });
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/gedcom/review/groups/events/accept',
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toContain('Accept the person @I1@');

    const queue = (await app.inject({ method: 'GET', url: '/api/gedcom/review' })).json();
    const personId = queue.groups.find((group: { group: string }) => group.group === 'people').items[0].id;
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/gedcom/review/${personId}/reject`,
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().status).toBe('rejected');
    expect((await app.inject({ method: 'GET', url: '/api/people' })).json()).toEqual([]);
  });

  it('accepts a selected person and their event atomically in dependency order', async () => {
    const form = formWithFile('selected.ged', [
      '0 HEAD',
      '1 CHAR UTF-8',
      '0 @I1@ INDI',
      '1 NAME John /Smith/',
      '1 BIRT',
      '2 DATE 1901',
    ].join('\n'));
    await app.inject({
      method: 'POST',
      url: '/api/gedcom/import',
      payload: form,
      headers: form.getHeaders(),
    });
    const queue = (await app.inject({ method: 'GET', url: '/api/gedcom/review' })).json();
    const personId = queue.groups.find((group: { group: string }) => group.group === 'people').items[0].id;
    const eventId = queue.groups.find((group: { group: string }) => group.group === 'events').items[0].id;

    const response = await app.inject({
      method: 'POST',
      url: '/api/gedcom/review/selection/accept',
      payload: { ids: [eventId, personId] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().map((item: { group: string; status: string }) => [item.group, item.status]))
      .toEqual([['people', 'accepted'], ['events', 'accepted']]);
    expect((await app.inject({ method: 'GET', url: '/api/people' })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/events' })).json()).toHaveLength(1);
  });

  it('validates selected GEDCOM review ids', async () => {
    expect((await app.inject({
      method: 'POST', url: '/api/gedcom/review/selection/accept', payload: { ids: [] },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: '/api/gedcom/review/selection/retry', payload: { ids: [1] },
    })).statusCode).toBe(400);
  });

  it('rejects invalid GEDCOM uploads with 400-level errors', async () => {
    const missing = await app.inject({ method: 'POST', url: '/api/gedcom/import' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ error: 'GEDCOM upload requires exactly one file' });

    const badExt = formWithFile('family.txt', '0 HEAD');
    const badExtRes = await app.inject({
      method: 'POST',
      url: '/api/gedcom/import',
      payload: badExt,
      headers: badExt.getHeaders(),
    });
    expect(badExtRes.statusCode).toBe(400);
    expect(badExtRes.json()).toEqual({ error: 'GEDCOM file must use .ged or .gedcom extension' });

    const empty = formWithFile('empty.ged', '');
    const emptyRes = await app.inject({
      method: 'POST',
      url: '/api/gedcom/import',
      payload: empty,
      headers: empty.getHeaders(),
    });
    expect(emptyRes.statusCode).toBe(400);
    expect(emptyRes.json()).toEqual({ error: 'GEDCOM file is empty' });

    const ansel = formWithFile('ansel.ged', '0 HEAD\n1 CHAR ANSEL\n0 TRLR');
    const anselRes = await app.inject({
      method: 'POST',
      url: '/api/gedcom/import',
      payload: ansel,
      headers: ansel.getHeaders(),
    });
    expect(anselRes.statusCode).toBe(415);
    expect(anselRes.json()).toEqual({ error: 'GEDCOM character encoding ANSEL is not supported' });

    const oversized = formWithFile('large.ged', '0 HEAD\n'.repeat(30));
    const oversizedRes = await app.inject({
      method: 'POST',
      url: '/api/gedcom/import',
      payload: oversized,
      headers: oversized.getHeaders(),
    });
    expect(oversizedRes.statusCode).toBe(413);
    expect(oversizedRes.json()).toEqual({ error: 'GEDCOM file exceeds the 128 byte limit' });
  });

  it('rejects multiple uploaded files', async () => {
    const form = new FormData();
    form.append('file', '0 HEAD', { filename: 'one.ged' });
    form.append('file', '0 HEAD', { filename: 'two.ged' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/gedcom/import',
      payload: form,
      headers: form.getHeaders(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'GEDCOM upload requires exactly one file' });
  });
});
