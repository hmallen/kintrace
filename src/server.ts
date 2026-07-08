import Fastify, { type FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { importFile, type MediaType } from './importer.js';
import { processPendingItems } from './ai/queue.js';
import { normalizeFuzzyDate } from './dates.js';
import type { TranscriptionEngine } from './ai/engine.js';

export interface ServerDeps {
  db: Database.Database;
  archiveDir: string;
  cacheDir: string;
  stagingDir: string;
  engine: TranscriptionEngine | null;
  aiDisabledMessage?: string;
}

/**
 * Maps an items row to its API shape: `ai_confidence` is parsed into an
 * object (null when unset or unparseable — the latter shouldn't happen, the
 * queue zod-gates it before writing). `ai_names` stays a raw JSON string
 * (frontend contract).
 */
function toItemResponse(row: Record<string, unknown>): Record<string, unknown> {
  let aiConfidence: unknown = null;
  if (typeof row.ai_confidence === 'string') {
    try {
      aiConfidence = JSON.parse(row.ai_confidence);
    } catch {
      aiConfidence = null;
    }
  }
  return { ...row, ai_confidence: aiConfidence };
}

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { db } = deps;
  const app = Fastify();
  // Without an explicit fileSize the plugin caps files at Fastify's bodyLimit
  // (1 MiB) — far below a typical archival scan. Uploads stream to disk, so no
  // cap is imposed here.
  app.register(fastifyMultipart, { limits: { fileSize: Infinity } });

  function itemPeople(itemId: number): unknown[] {
    return db
      .prepare(
        'SELECT p.id, p.name, ip.role FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ?'
      )
      .all(itemId);
  }

  app.get('/api/items', (req) => {
    const { status, personId } = req.query as { status?: string; personId?: string };
    let sql =
      'SELECT DISTINCT i.id, i.title, i.media_type, i.date_start, i.date_end, i.date_precision, i.status, i.content_hash, i.thumb_path FROM items i';
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
    return { ...toItemResponse(item as Record<string, unknown>), people: itemPeople(id) };
  });

  app.patch('/api/items/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const item = db.prepare('SELECT id, status FROM items WHERE id = ?').get(id) as
      | { id: number; status: string }
      | undefined;
    if (!item) return reply.code(404).send({ error: 'not found' });
    const body = (req.body ?? {}) as {
      title?: string; description?: string;
      transcription_diplomatic?: string; transcription_normalized?: string;
      date?: { start?: string | null; end?: string | null; precision?: string };
      status?: string;
    };
    const hasKnownField = [
      'title', 'description', 'transcription_diplomatic', 'transcription_normalized', 'date', 'status',
    ].some((f) => (body as Record<string, unknown>)[f] !== undefined);
    if (!hasKnownField) {
      return reply.code(400).send({ error: 'request body required' });
    }
    if (body.status !== undefined && body.status !== 'reviewed') {
      return reply.code(400).send({ error: 'invalid status' });
    }
    if (body.status === 'reviewed' && item.status === 'pending') {
      return reply.code(409).send({ error: 'item not transcribed yet' });
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const field of ['title', 'description', 'transcription_diplomatic', 'transcription_normalized'] as const) {
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
    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    return { ...toItemResponse(updated as Record<string, unknown>), people: itemPeople(id) };
  });

  app.get('/api/items/:id/thumbnail', (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const item = db.prepare('SELECT thumb_path FROM items WHERE id = ?').get(id) as
      | { thumb_path: string | null }
      | undefined;
    if (!item || !item.thumb_path || !fs.existsSync(item.thumb_path)) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.type('image/jpeg').send(fs.createReadStream(item.thumb_path));
  });

  app.get('/api/items/:id/file', (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const item = db.prepare('SELECT file_path FROM items WHERE id = ?').get(id) as
      | { file_path: string | null }
      | undefined;
    if (!item || !item.file_path || !fs.existsSync(item.file_path)) {
      return reply.code(404).send({ error: 'not found' });
    }
    const ext = path.extname(item.file_path).toLowerCase();
    const contentType = EXTENSION_CONTENT_TYPES[ext] ?? 'application/octet-stream';
    return reply
      .type(contentType)
      .header('Content-Disposition', 'inline')
      .send(fs.createReadStream(item.file_path));
  });

  const ITEM_PEOPLE_ROLES = new Set(['subject', 'author', 'recipient']);

  app.post('/api/items/:id/people', (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { personId, role } = (req.body ?? {}) as { personId: unknown; role: unknown };
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
    const { name, notes } = (req.body ?? {}) as { name?: string; notes?: string };
    if (!name) return reply.code(400).send({ error: 'name required' });
    const info = db.prepare('INSERT INTO people (name, notes) VALUES (?, ?)').run(name, notes ?? null);
    reply.code(201).send({ id: Number(info.lastInsertRowid), name });
  });

  const MEDIA_TYPES = new Set<MediaType>(['photo', 'letter', 'article', 'audio', 'video', 'pdf']);

  app.post('/api/import', async (req, reply) => {
    const { paths, mediaType } = (req.body ?? {}) as { paths: unknown; mediaType: unknown };
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

  app.post('/api/upload', async (req, reply) => {
    await mkdir(deps.stagingDir, { recursive: true });
    // Stage every file part as it streams in (mediaType may arrive after the
    // files, so imports run only once all parts are consumed).
    const staged: { filename: string; stagedPath: string }[] = [];
    let mediaType: unknown;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const unique = randomBytes(8).toString('hex');
          const stagedPath = path.join(
            deps.stagingDir,
            `${unique}-${path.basename(part.filename)}`
          );
          await pipeline(part.file, fs.createWriteStream(stagedPath));
          staged.push({ filename: part.filename, stagedPath });
        } else if (part.fieldname === 'mediaType') {
          mediaType = part.value;
        }
      }
      if (typeof mediaType !== 'string' || !MEDIA_TYPES.has(mediaType as MediaType)) {
        // Return (not reply.send) so the finally-block cleanup completes
        // before Fastify serializes the response.
        reply.code(400);
        return { error: 'mediaType must be one of photo, letter, article, audio, video, pdf' };
      }
      const validMediaType = mediaType as MediaType;
      const results = [];
      for (const { filename, stagedPath } of staged) {
        try {
          const r = await importFile(deps.db, stagedPath, {
            archiveDir: deps.archiveDir,
            cacheDir: deps.cacheDir,
            mediaType: validMediaType,
          });
          results.push({ path: filename, ...r });
        } catch (e) {
          results.push({ path: filename, error: (e as Error).message });
        }
      }
      return results;
    } finally {
      await Promise.all(staged.map(({ stagedPath }) => rm(stagedPath, { force: true })));
    }
  });

  app.post('/api/queue/process', async (_req, reply) => {
    if (!deps.engine) {
      return reply.code(503).send({ error: deps.aiDisabledMessage ?? 'AI transcription not configured' });
    }
    return processPendingItems(deps.db, deps.engine);
  });

  return app;
}
