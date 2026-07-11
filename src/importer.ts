import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import type Database from 'better-sqlite3';

export type MediaType = 'photo' | 'letter' | 'article' | 'audio' | 'video' | 'pdf';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);

export interface ImportOptions {
  archiveDir: string;
  cacheDir: string;
  mediaType: MediaType;
  originalFilename?: string;
}

async function hashFile(sourcePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(sourcePath), hash);
  return hash.digest('hex');
}

export async function importFile(
  db: Database.Database,
  sourcePath: string,
  opts: ImportOptions
): Promise<{ itemId: number; duplicate: boolean }> {
  const hash = await hashFile(sourcePath);

  const existing = db
    .prepare('SELECT id FROM items WHERE content_hash = ?')
    .get(hash) as { id: number } | undefined;
  if (existing) return { itemId: existing.id, duplicate: true };

  await mkdir(opts.archiveDir, { recursive: true });
  await mkdir(opts.cacheDir, { recursive: true });

  // Per-call unique names: two concurrent imports of the same content must not
  // write to the same archive/thumbnail path, or one call's post-failure cleanup
  // could delete the file backing the other call's successful DB row.
  const unique = randomBytes(4).toString('hex');
  const ext = extname(sourcePath).toLowerCase();
  const destPath = join(opts.archiveDir, `${hash.slice(0, 16)}-${unique}-${basename(sourcePath)}`);
  const thumbPath = join(opts.cacheDir, `${hash.slice(0, 16)}-${unique}-thumb.jpg`);
  await copyFile(sourcePath, destPath);

  try {
    const isImage = IMAGE_EXTS.has(ext);
    if (isImage) {
      await sharp(destPath)
        .resize({ width: 512, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(thumbPath);
    }

    const info = db
      .prepare(
        'INSERT INTO items (file_path, content_hash, media_type, thumb_path, original_filename) VALUES (?, ?, ?, ?, ?)'
      )
      .run(destPath, hash, opts.mediaType, isImage ? thumbPath : null, opts.originalFilename ?? basename(sourcePath));
    return { itemId: Number(info.lastInsertRowid), duplicate: false };
  } catch (err) {
    // Clean up anything this call created that ended up untracked, whether
    // that's a thumbnailing failure or losing a concurrent duplicate-import race.
    await rm(destPath, { force: true });
    await rm(thumbPath, { force: true });

    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const winner = db
        .prepare('SELECT id FROM items WHERE content_hash = ?')
        .get(hash) as { id: number } | undefined;
      if (winner) return { itemId: winner.id, duplicate: true };
    }
    throw err;
  }
}
