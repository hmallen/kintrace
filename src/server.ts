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
import {
  StoryGenerationError,
  generateAndSaveTimelineStory,
  getTimelineStoryState,
  listStorySources,
  type StoryGenerator,
} from './ai/story.js';
import { GedcomImportError, importGedcomFile } from './gedcom/importer.js';
import {
  GedcomReviewError,
  REVIEW_GROUPS,
  listGedcomReviewQueue,
  reviewGedcomGroup,
  reviewGedcomItem,
  reviewGedcomSelection,
  type ReviewAction,
  type ReviewGroup,
} from './gedcom/review.js';
import { MergePeopleError, listLibraryPersonGroups, mergePeople } from './people.js';
import {
  ItemGroupError,
  addItemToGroup,
  createOrMergeItemGroup,
  getItemGroup,
  getItemGroupForItem,
  listItemGroups,
  linkItemGroupToPerson,
  removeItemFromGroup,
  suggestItemGroupCandidates,
  updateItemGroupLabel,
} from './item-groups.js';
import {
  AddItemGroupMemberBodySchema,
  CreateItemGroupBodySchema,
  LinkPersonBodySchema,
  UpdateItemGroupBodySchema,
} from '../shared/api.js';

export interface ServerDeps {
  db: Database.Database;
  archiveDir: string;
  cacheDir: string;
  stagingDir: string;
  gedcomArchiveDir?: string;
  gedcomMaxBytes?: number;
  engine: TranscriptionEngine | null;
  aiDisabledMessage?: string;
  storyGenerator?: StoryGenerator | null;
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

const MEDIA_TYPES = new Set<MediaType>(['photo', 'letter', 'article', 'audio', 'video', 'pdf']);

function inferUploadMediaType(filename: string, fallback: MediaType): MediaType {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (['.mp3', '.wav'].includes(ext)) return 'audio';
  if (['.mp4', '.mov', '.webm'].includes(ext)) return 'video';
  return fallback;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { db } = deps;
  const storyGenerator = deps.storyGenerator ?? null;
  let storyGenerationRunning = false;
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

  app.get('/api/timeline/story', () => getTimelineStoryState(db, storyGenerator));

  app.post('/api/timeline/story', async (_req, reply) => {
    if (!storyGenerator) {
      return reply.code(503).send({ error: 'OpenAI story generation is not configured' });
    }
    if (storyGenerationRunning) {
      return reply.code(409).send({ error: 'Story generation is already running' });
    }
    if (listStorySources(db).length === 0) {
      return reply.code(409).send({ error: 'No reviewed media is available' });
    }
    storyGenerationRunning = true;
    try {
      return await generateAndSaveTimelineStory(db, storyGenerator);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Story generation failed';
      if (error instanceof StoryGenerationError && message === 'No reviewed media is available') {
        return reply.code(409).send({ error: message });
      }
      return reply.code(502).send({ error: message });
    } finally {
      storyGenerationRunning = false;
    }
  });

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
    return {
      ...toItemResponse(item as Record<string, unknown>),
      people: itemPeople(id),
      group: getItemGroupForItem(db, id),
    };
  });

  app.get('/api/items/:id/group-suggestions', (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ error: 'invalid item id' });
    }
    try {
      return suggestItemGroupCandidates(db, id);
    } catch (err) {
      if (err instanceof ItemGroupError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  app.post('/api/item-groups', (req, reply) => {
    const parsed = CreateItemGroupBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'itemIds must contain at least two item ids' });
    try {
      return reply.code(201).send(createOrMergeItemGroup(db, parsed.data.itemIds, parsed.data.label));
    } catch (err) {
      if (err instanceof ItemGroupError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  app.get('/api/item-groups', () => listItemGroups(db));

  app.get('/api/library/people', () => listLibraryPersonGroups(db));

  app.get('/api/item-groups/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isSafeInteger(id) || id < 1) return reply.code(400).send({ error: 'invalid group id' });
    const group = getItemGroup(db, id);
    return group ?? reply.code(404).send({ error: 'item group not found' });
  });

  app.patch('/api/item-groups/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isSafeInteger(id) || id < 1) return reply.code(400).send({ error: 'invalid group id' });
    const parsed = UpdateItemGroupBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'label must be 1 to 200 characters or null' });
    try {
      return updateItemGroupLabel(db, id, parsed.data.label);
    } catch (err) {
      if (err instanceof ItemGroupError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  app.post('/api/item-groups/:id/items', (req, reply) => {
    const groupId = Number((req.params as { id: string }).id);
    if (!Number.isSafeInteger(groupId) || groupId < 1) {
      return reply.code(400).send({ error: 'invalid group id' });
    }
    const parsed = AddItemGroupMemberBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'itemId must be a positive integer' });
    try {
      return addItemToGroup(db, groupId, parsed.data.itemId);
    } catch (err) {
      if (err instanceof ItemGroupError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  app.post('/api/item-groups/:id/people', (req, reply) => {
    const groupId = Number((req.params as { id: string }).id);
    if (!Number.isSafeInteger(groupId) || groupId < 1) {
      return reply.code(400).send({ error: 'invalid group id' });
    }
    const parsed = LinkPersonBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'personId and a valid role are required' });
    }
    try {
      linkItemGroupToPerson(db, groupId, parsed.data.personId, parsed.data.role);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ItemGroupError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  app.delete('/api/item-groups/:id/items/:itemId', (req, reply) => {
    const { id: rawGroupId, itemId: rawItemId } = req.params as { id: string; itemId: string };
    const groupId = Number(rawGroupId);
    const itemId = Number(rawItemId);
    if (!Number.isSafeInteger(groupId) || groupId < 1 || !Number.isSafeInteger(itemId) || itemId < 1) {
      return reply.code(400).send({ error: 'invalid group or item id' });
    }
    try {
      removeItemFromGroup(db, groupId, itemId);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof ItemGroupError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  app.patch('/api/items/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const item = db.prepare('SELECT id, status FROM items WHERE id = ?').get(id) as
      | { id: number; status: string }
      | undefined;
    if (!item) return reply.code(404).send({ error: 'not found' });
    const body = (req.body ?? {}) as {
      media_type?: string; title?: string; description?: string;
      transcription_diplomatic?: string; transcription_normalized?: string;
      date?: { start?: string | null; end?: string | null; precision?: string };
      status?: string;
    };
    const hasKnownField = [
      'media_type', 'title', 'description', 'transcription_diplomatic', 'transcription_normalized', 'date', 'status',
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
    if (body.media_type !== undefined) {
      if (!MEDIA_TYPES.has(body.media_type as MediaType)) {
        return reply.code(400).send({ error: 'invalid media type' });
      }
      if (item.status !== 'pending') {
        return reply.code(409).send({ error: 'media type can only be changed while an item is pending' });
      }
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.media_type !== undefined) {
      sets.push('media_type = ?');
      params.push(body.media_type);
    }
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
    return {
      ...toItemResponse(updated as Record<string, unknown>),
      people: itemPeople(id),
      group: getItemGroupForItem(db, id),
    };
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

  app.delete('/api/items/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ error: 'invalid item id' });
    }
    const membership = db.prepare('SELECT group_id FROM item_group_members WHERE item_id = ?').get(id) as
      | { group_id: number }
      | undefined;
    const result = db.prepare('DELETE FROM items WHERE id = ?').run(id);
    if (result.changes === 0) return reply.code(404).send({ error: 'item not found' });
    if (membership) {
      const remaining = (db.prepare(
        'SELECT COUNT(*) AS count FROM item_group_members WHERE group_id = ?'
      ).get(membership.group_id) as { count: number }).count;
      if (remaining < 2) db.prepare('DELETE FROM item_groups WHERE id = ?').run(membership.group_id);
    }
    return reply.code(204).send();
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

  app.delete('/api/items/:id/people/:personId/:role', (req, reply) => {
    const { id: rawItemId, personId: rawPersonId, role } = req.params as {
      id: string;
      personId: string;
      role: string;
    };
    const itemId = Number(rawItemId);
    const personId = Number(rawPersonId);
    if (!Number.isSafeInteger(itemId) || itemId < 1 || !Number.isSafeInteger(personId) || personId < 1) {
      return reply.code(400).send({ error: 'invalid item or person id' });
    }
    if (!ITEM_PEOPLE_ROLES.has(role)) {
      return reply.code(400).send({ error: 'role must be one of subject, author, recipient' });
    }
    if (!db.prepare('SELECT id FROM items WHERE id = ?').get(itemId)) {
      return reply.code(404).send({ error: 'item not found' });
    }
    const result = db.prepare(
      'DELETE FROM item_people WHERE item_id = ? AND person_id = ? AND role = ?',
    ).run(itemId, personId, role);
    if (result.changes === 0) return reply.code(404).send({ error: 'person tag not found' });
    return reply.code(204).send();
  });

  app.get('/api/people', () => db.prepare('SELECT * FROM people ORDER BY name').all());

  app.get('/api/events', () =>
    db
      .prepare(
        `SELECT
          id, title, description, date_start, date_end, date_precision, person_id,
          CASE WHEN gedcom_import_id IS NULL THEN NULL ELSE 'gedcom' END AS source_type,
          gedcom_import_id, gedcom_xref, gedcom_tag, gedcom_date_raw, source_text
        FROM events
        ORDER BY date_start IS NULL, date_start, title`
      )
      .all()
  );

  app.post('/api/people', (req, reply) => {
    const { name, notes } = (req.body ?? {}) as { name?: string; notes?: string };
    if (!name) return reply.code(400).send({ error: 'name required' });
    const info = db.prepare('INSERT INTO people (name, notes) VALUES (?, ?)').run(name, notes ?? null);
    reply.code(201).send({ id: Number(info.lastInsertRowid), name });
  });

  app.post('/api/people/merge', (req, reply) => {
    const { keepId, duplicateId } = (req.body ?? {}) as {
      keepId?: unknown;
      duplicateId?: unknown;
    };
    if (!Number.isSafeInteger(keepId) || !Number.isSafeInteger(duplicateId)) {
      return reply.code(400).send({ error: 'keepId and duplicateId must be integers' });
    }
    try {
      return mergePeople(db, keepId as number, duplicateId as number);
    } catch (err) {
      if (err instanceof MergePeopleError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

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
          originalFilename: path.basename(p),
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
    let imageFallback: unknown;
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
        } else if (part.fieldname === 'imageFallback') {
          imageFallback = part.value;
        }
      }
      const auto = mediaType === 'auto';
      if ((!auto && (typeof mediaType !== 'string' || !MEDIA_TYPES.has(mediaType as MediaType)))
        || (auto && (typeof imageFallback !== 'string' || !MEDIA_TYPES.has(imageFallback as MediaType)))) {
        // Return (not reply.send) so the finally-block cleanup completes
        // before Fastify serializes the response.
        reply.code(400);
        return { error: 'mediaType must be auto or one of photo, letter, article, audio, video, pdf' };
      }
      const results = [];
      for (const { filename, stagedPath } of staged) {
        try {
          const validMediaType = auto
            ? inferUploadMediaType(filename, imageFallback as MediaType)
            : mediaType as MediaType;
          const r = await importFile(deps.db, stagedPath, {
            archiveDir: deps.archiveDir,
            cacheDir: deps.cacheDir,
            mediaType: validMediaType,
            originalFilename: filename,
          });
          const item = db.prepare('SELECT media_type, status FROM items WHERE id = ?').get(r.itemId) as {
            media_type: MediaType; status: 'pending' | 'transcribed' | 'reviewed';
          };
          results.push({
            path: filename,
            ...r,
            mediaType: item.media_type,
            status: item.status,
            autoSelected: auto && item.media_type === validMediaType,
          });
        } catch (e) {
          results.push({ path: filename, error: (e as Error).message });
        }
      }
      return results;
    } finally {
      await Promise.all(staged.map(({ stagedPath }) => rm(stagedPath, { force: true })));
    }
  });

  app.post('/api/gedcom/import', async (req, reply) => {
    if (!(req as { isMultipart?: () => boolean }).isMultipart?.()) {
      return reply.code(400).send({ error: 'GEDCOM upload requires exactly one file' });
    }

    await mkdir(deps.stagingDir, { recursive: true });
    const staged: { filename: string; stagedPath: string }[] = [];
    try {
      for await (const part of req.parts()) {
        if (part.type !== 'file') continue;
        const unique = randomBytes(8).toString('hex');
        const stagedPath = path.join(
          deps.stagingDir,
          `${unique}-${path.basename(part.filename)}`
        );
        await pipeline(part.file, fs.createWriteStream(stagedPath));
        staged.push({ filename: part.filename, stagedPath });
      }

      if (staged.length !== 1) {
        return reply.code(400).send({ error: 'GEDCOM upload requires exactly one file' });
      }
      const maxBytes = deps.gedcomMaxBytes ?? 25 * 1024 * 1024;
      const stagedSize = (await fs.promises.stat(staged[0]!.stagedPath)).size;
      if (stagedSize > maxBytes) {
        return reply.code(413).send({ error: `GEDCOM file exceeds the ${maxBytes} byte limit` });
      }

      try {
        const result = await importGedcomFile(deps.db, staged[0]!.stagedPath, {
          archiveDir: deps.gedcomArchiveDir ?? path.join(deps.archiveDir, 'gedcom'),
          originalFilename: staged[0]!.filename,
        });
        return reply.code(result.duplicate ? 200 : 201).send(result);
      } catch (err) {
        if (err instanceof GedcomImportError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    } finally {
      await Promise.all(staged.map(({ stagedPath }) => rm(stagedPath, { force: true })));
    }
  });

  app.get('/api/gedcom/review', () => listGedcomReviewQueue(db));

  app.post('/api/gedcom/review/:id/:action', (req, reply) => {
    const { id: rawId, action: rawAction } = req.params as { id: string; action: string };
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ error: 'invalid review item id' });
    }
    if (rawAction !== 'accept' && rawAction !== 'reject') {
      return reply.code(400).send({ error: 'review action must be accept or reject' });
    }
    try {
      return reviewGedcomItem(db, id, rawAction);
    } catch (err) {
      if (err instanceof GedcomReviewError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post('/api/gedcom/review/groups/:group/:action', (req, reply) => {
    const { group: rawGroup, action: rawAction } = req.params as { group: string; action: string };
    if (!REVIEW_GROUPS.includes(rawGroup as ReviewGroup)) {
      return reply.code(400).send({ error: 'invalid GEDCOM review group' });
    }
    if (rawAction !== 'accept' && rawAction !== 'reject') {
      return reply.code(400).send({ error: 'review action must be accept or reject' });
    }
    try {
      return reviewGedcomGroup(db, rawGroup as ReviewGroup, rawAction as ReviewAction);
    } catch (err) {
      if (err instanceof GedcomReviewError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post('/api/gedcom/review/selection/:action', (req, reply) => {
    const { action: rawAction } = req.params as { action: string };
    const { ids } = (req.body ?? {}) as { ids?: unknown };
    if (rawAction !== 'accept' && rawAction !== 'reject') {
      return reply.code(400).send({ error: 'review action must be accept or reject' });
    }
    if (
      !Array.isArray(ids)
      || ids.length === 0
      || !ids.every((id) => Number.isSafeInteger(id) && id > 0)
    ) {
      return reply.code(400).send({ error: 'ids must be a non-empty array of positive integers' });
    }
    try {
      return reviewGedcomSelection(db, ids as number[], rawAction as ReviewAction);
    } catch (err) {
      if (err instanceof GedcomReviewError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
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
