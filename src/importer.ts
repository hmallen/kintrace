import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import type Database from 'better-sqlite3';

export type MediaType = 'photo' | 'letter' | 'article' | 'audio' | 'video' | 'pdf';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);

export interface ImportOptions {
  archiveDir: string;
  cacheDir: string;
  mediaType: MediaType;
}

export async function importFile(
  db: Database.Database,
  sourcePath: string,
  opts: ImportOptions
): Promise<{ itemId: number; duplicate: boolean }> {
  const bytes = await readFile(sourcePath);
  const hash = createHash('sha256').update(bytes).digest('hex');

  const existing = db
    .prepare('SELECT id FROM items WHERE content_hash = ?')
    .get(hash) as { id: number } | undefined;
  if (existing) return { itemId: existing.id, duplicate: true };

  await mkdir(opts.archiveDir, { recursive: true });
  await mkdir(opts.cacheDir, { recursive: true });

  const ext = extname(sourcePath).toLowerCase();
  const destPath = join(opts.archiveDir, `${hash.slice(0, 16)}-${basename(sourcePath)}`);
  await copyFile(sourcePath, destPath);

  if (IMAGE_EXTS.has(ext)) {
    await sharp(destPath)
      .resize({ width: 512, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(join(opts.cacheDir, `${hash.slice(0, 16)}-thumb.jpg`));
  }

  const info = db
    .prepare('INSERT INTO items (file_path, content_hash, media_type) VALUES (?, ?, ?)')
    .run(destPath, hash, opts.mediaType);
  return { itemId: Number(info.lastInsertRowid), duplicate: false };
}
