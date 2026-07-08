import sharp from 'sharp';
import type Database from 'better-sqlite3';
import type { TranscriptionEngine } from './engine.js';
import { normalizeFuzzyDate } from '../dates.js';

async function defaultResize(path: string): Promise<Buffer> {
  return sharp(path).resize({ width: 1568, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

export async function processPendingItems(
  db: Database.Database,
  engine: TranscriptionEngine,
  opts: { resizeForAi?: (path: string) => Promise<Buffer> } = {}
): Promise<{ processed: number; failed: number }> {
  const resize = opts.resizeForAi ?? defaultResize;
  const pending = db
    .prepare("SELECT id, file_path, media_type FROM items WHERE status = 'pending' ORDER BY id")
    .all() as { id: number; file_path: string; media_type: string }[];

  let processed = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const pages = db
        .prepare('SELECT file_path FROM pages WHERE item_id = ? ORDER BY page_index')
        .all(item.id) as { file_path: string }[];
      const paths = pages.length > 0 ? pages.map((p) => p.file_path) : [item.file_path];
      const images = await Promise.all(paths.map(resize));

      const result = await engine.transcribe(images, item.media_type);
      const date = normalizeFuzzyDate(result.date);

      db.prepare(
        `UPDATE items SET transcription_diplomatic = ?, transcription_normalized = ?,
           title = ?, description = ?,
           date_start = ?, date_end = ?, date_precision = ?,
           ai_names = ?, ai_confidence = ?, ai_error = NULL, status = 'transcribed'
         WHERE id = ?`
      ).run(
        result.transcriptionDiplomatic, result.transcriptionNormalized,
        result.title, result.description,
        date.start, date.end, date.precision,
        JSON.stringify(result.names), JSON.stringify(result.confidence), item.id
      );
      processed++;
    } catch (e) {
      db.prepare('UPDATE items SET ai_error = ? WHERE id = ?').run(
        e instanceof Error ? e.message : String(e),
        item.id
      );
      failed++;
    }
  }
  return { processed, failed };
}
