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
      'SELECT i.id, i.title, i.media_type, i.date_start, i.date_end, i.date_precision, i.status, i.content_hash, i.thumb_path FROM items i';
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
    const item = db.prepare('SELECT id, status FROM items WHERE id = ?').get(id) as
      | { id: number; status: string }
      | undefined;
    if (!item) return reply.code(404).send({ error: 'not found' });
    const body = req.body as {
      title?: string; description?: string; transcription?: string;
      date?: { start?: string | null; end?: string | null; precision?: string };
      status?: string;
    };
    if (body.status !== undefined && body.status !== 'reviewed') {
      return reply.code(400).send({ error: 'invalid status' });
    }
    if (body.status === 'reviewed' && item.status === 'pending') {
      return reply.code(409).send({ error: 'item not transcribed yet' });
    }
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

  const ITEM_PEOPLE_ROLES = new Set(['subject', 'author', 'recipient']);

  app.post('/api/items/:id/people', (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { personId, role } = req.body as { personId: unknown; role: unknown };
    if (typeof personId !== 'number' || !Number.isFinite(personId)) {
      return reply.code(400).send({ error: 'personId must be a number' });
    }
    if (typeof role !== 'string' || !ITEM_PEOPLE_ROLES.has(role)) {
      return reply.code(400).send({ error: 'role must be one of subject, author, recipient' });
    }
    const item = db.prepare('SELECT id FROM items WHERE id = ?').get(id);
    if (!item) return reply.code(404).send({ error: 'item not found' });
    const person = db.prepare('SELECT id FROM people WHERE id = ?').get(personId);
    if (!person) return reply.code(404).send({ error: 'person not found' });
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

  const MEDIA_TYPES = new Set<MediaType>(['photo', 'letter', 'article', 'audio', 'video', 'pdf']);

  app.post('/api/import', async (req, reply) => {
    const { paths, mediaType } = req.body as { paths: unknown; mediaType: unknown };
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) {
      return reply.code(400).send({ error: 'paths must be an array of strings' });
    }
    if (typeof mediaType !== 'string' || !MEDIA_TYPES.has(mediaType as MediaType)) {
      return reply.code(400).send({ error: 'mediaType must be one of photo, letter, article, audio, video, pdf' });
    }
    const validPaths = paths as string[];
    const validMediaType = mediaType as MediaType;
    const results = [];
    for (const p of validPaths) {
      try {
        const r = await importFile(deps.db, p, {
          archiveDir: deps.archiveDir,
          cacheDir: deps.cacheDir,
          mediaType: validMediaType,
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
