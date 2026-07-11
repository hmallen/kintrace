import path from 'node:path';
import type Database from 'better-sqlite3';

const ITEM_SUMMARY_COLUMNS = `
  i.id, i.title, i.media_type, i.date_start, i.date_end, i.date_precision,
  i.status, i.content_hash, i.thumb_path
`;

interface GroupRow {
  id: number;
  label: string | null;
  created_at: string;
}

interface CandidateRow extends Record<string, unknown> {
  id: number;
  title: string | null;
  original_filename: string | null;
  transcription_normalized: string | null;
  transcription_diplomatic: string | null;
  media_type: string;
  date_start: string | null;
  date_end: string | null;
  date_precision: string;
}

export class ItemGroupError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'ItemGroupError';
  }
}

export function getItemGroup(db: Database.Database, groupId: number): Record<string, unknown> | null {
  const group = db.prepare('SELECT id, label, created_at FROM item_groups WHERE id = ?').get(groupId) as
    | GroupRow
    | undefined;
  if (!group) return null;
  const items = db.prepare(`
    SELECT ${ITEM_SUMMARY_COLUMNS}
    FROM item_group_members gm
    JOIN items i ON i.id = gm.item_id
    WHERE gm.group_id = ?
    ORDER BY gm.position, gm.item_id
  `).all(groupId);
  return { id: group.id, label: group.label, createdAt: group.created_at, items };
}

export function getItemGroupForItem(db: Database.Database, itemId: number): Record<string, unknown> | null {
  const row = db.prepare('SELECT group_id FROM item_group_members WHERE item_id = ?').get(itemId) as
    | { group_id: number }
    | undefined;
  return row ? getItemGroup(db, row.group_id) : null;
}

export function listItemGroups(db: Database.Database): Record<string, unknown>[] {
  const rows = db.prepare(
    'SELECT id FROM item_groups ORDER BY created_at, id'
  ).all() as { id: number }[];
  return rows.map(({ id }) => getItemGroup(db, id)).filter(
    (group): group is Record<string, unknown> => group !== null,
  );
}

function requireItems(db: Database.Database, itemIds: number[]): number[] {
  const unique = [...new Set(itemIds)];
  if (unique.length < 2) throw new ItemGroupError(400, 'at least two distinct itemIds are required');
  const placeholders = unique.map(() => '?').join(',');
  const found = db.prepare(`SELECT id FROM items WHERE id IN (${placeholders})`).all(...unique) as { id: number }[];
  if (found.length !== unique.length) throw new ItemGroupError(404, 'one or more items were not found');
  return unique;
}

export function createOrMergeItemGroup(
  db: Database.Database,
  itemIds: number[],
  label?: string,
): Record<string, unknown> {
  const ids = requireItems(db, itemIds);
  const run = db.transaction(() => {
    const placeholders = ids.map(() => '?').join(',');
    const memberships = db.prepare(
      `SELECT item_id, group_id FROM item_group_members WHERE item_id IN (${placeholders}) ORDER BY group_id`
    ).all(...ids) as { item_id: number; group_id: number }[];
    let targetId = memberships[0]?.group_id;
    if (targetId === undefined) {
      targetId = Number(db.prepare('INSERT INTO item_groups (label) VALUES (?)').run(label ?? null).lastInsertRowid);
    } else if (label !== undefined) {
      db.prepare('UPDATE item_groups SET label = ? WHERE id = ?').run(label, targetId);
    }

    const sourceGroups = [...new Set(memberships.map(({ group_id }) => group_id))]
      .filter((groupId) => groupId !== targetId);
    for (const sourceId of sourceGroups) {
      const nextPosition = (db.prepare(
        'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM item_group_members WHERE group_id = ?'
      ).get(targetId) as { next: number }).next;
      const sourceItems = db.prepare(
        'SELECT item_id FROM item_group_members WHERE group_id = ? ORDER BY position, item_id'
      ).all(sourceId) as { item_id: number }[];
      sourceItems.forEach(({ item_id }, index) => {
        db.prepare('UPDATE item_group_members SET group_id = ?, position = ? WHERE item_id = ?')
          .run(targetId, nextPosition + index, item_id);
      });
      db.prepare('DELETE FROM item_groups WHERE id = ?').run(sourceId);
    }

    let nextPosition = (db.prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM item_group_members WHERE group_id = ?'
    ).get(targetId) as { next: number }).next;
    const insert = db.prepare(
      'INSERT OR IGNORE INTO item_group_members (group_id, item_id, position) VALUES (?, ?, ?)'
    );
    for (const itemId of ids) {
      const result = insert.run(targetId, itemId, nextPosition);
      if (result.changes > 0) nextPosition += 1;
    }
    return targetId;
  });

  const group = getItemGroup(db, run());
  if (!group) throw new Error('created item group was not found');
  return group;
}

export function updateItemGroupLabel(
  db: Database.Database,
  groupId: number,
  label: string | null,
): Record<string, unknown> {
  const result = db.prepare('UPDATE item_groups SET label = ? WHERE id = ?').run(label, groupId);
  if (result.changes === 0) throw new ItemGroupError(404, 'item group not found');
  const group = getItemGroup(db, groupId);
  if (!group) throw new Error('updated item group was not found');
  return group;
}

export function addItemToGroup(
  db: Database.Database,
  groupId: number,
  itemId: number,
): Record<string, unknown> {
  const target = getItemGroup(db, groupId);
  if (!target) throw new ItemGroupError(404, 'item group not found');
  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(itemId);
  if (!item) throw new ItemGroupError(404, 'item not found');
  const current = db.prepare('SELECT group_id FROM item_group_members WHERE item_id = ?').get(itemId) as
    | { group_id: number }
    | undefined;
  if (current?.group_id === groupId) return target;
  const run = db.transaction(() => {
    let nextPosition = (db.prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM item_group_members WHERE group_id = ?'
    ).get(groupId) as { next: number }).next;

    if (current) {
      const sourceItems = db.prepare(
        'SELECT item_id FROM item_group_members WHERE group_id = ? ORDER BY position, item_id'
      ).all(current.group_id) as { item_id: number }[];
      for (const source of sourceItems) {
        db.prepare('UPDATE item_group_members SET group_id = ?, position = ? WHERE item_id = ?')
          .run(groupId, nextPosition, source.item_id);
        nextPosition += 1;
      }
      db.prepare('DELETE FROM item_groups WHERE id = ?').run(current.group_id);
    } else {
      db.prepare(
        'INSERT INTO item_group_members (group_id, item_id, position) VALUES (?, ?, ?)'
      ).run(groupId, itemId, nextPosition);
    }
  });
  run();
  const updated = getItemGroup(db, groupId);
  if (!updated) throw new Error('updated item group was not found');
  return updated;
}

export function linkItemGroupToPerson(
  db: Database.Database,
  groupId: number,
  personId: number,
  role: 'subject' | 'author' | 'recipient',
): void {
  if (!getItemGroup(db, groupId)) throw new ItemGroupError(404, 'item group not found');
  if (!db.prepare('SELECT id FROM people WHERE id = ?').get(personId)) {
    throw new ItemGroupError(404, 'person not found');
  }
  db.prepare(`
    INSERT OR IGNORE INTO item_people (item_id, person_id, role)
    SELECT item_id, ?, ? FROM item_group_members WHERE group_id = ?
  `).run(personId, role, groupId);
}

export function removeItemFromGroup(db: Database.Database, groupId: number, itemId: number): void {
  const result = db.prepare('DELETE FROM item_group_members WHERE group_id = ? AND item_id = ?').run(groupId, itemId);
  if (result.changes === 0) throw new ItemGroupError(404, 'group membership not found');
  const remaining = (db.prepare('SELECT COUNT(*) AS count FROM item_group_members WHERE group_id = ?').get(groupId) as
    { count: number }).count;
  if (remaining < 2) db.prepare('DELETE FROM item_groups WHERE id = ?').run(groupId);
}

const VIEW_WORDS = new Set([
  'angle', 'back', 'bottom', 'close', 'closeup', 'copy', 'crop', 'detail', 'front',
  'left', 'macro', 'magnified', 'overview', 'right', 'scan', 'side', 'top', 'view',
  'wide', 'zoom',
]);
const GENERIC_CAMERA_WORDS = new Set(['dsc', 'dscn', 'img', 'image', 'photo', 'pxl']);

function filenameKey(filename: string | null): string | null {
  if (!filename) return null;
  const stem = path.parse(filename).name.toLowerCase();
  const rawWords = stem.split(/[^a-z0-9]+/).filter(Boolean);
  const words = rawWords.filter((word) => !VIEW_WORDS.has(word));
  if (words.length === 0 || words.every((word) => GENERIC_CAMERA_WORDS.has(word) || /^\d+$/.test(word))) {
    return null;
  }
  return words.join(' ');
}

function normalizedText(value: string | null): string | null {
  if (!value) return null;
  const text = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return text.length >= 30 ? text : null;
}

function levenshteinDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

function normalizedTitle(value: string | null): string | null {
  if (!value) return null;
  const title = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return title.length >= 8 ? title : null;
}

function titlesMatch(source: CandidateRow, candidate: CandidateRow): boolean {
  const left = normalizedTitle(source.title);
  const right = normalizedTitle(candidate.title);
  if (!left || !right) return false;
  if (left === right) return true;
  const sameClassification = source.media_type === candidate.media_type
    && source.date_start === candidate.date_start
    && source.date_end === candidate.date_end
    && source.date_precision === candidate.date_precision;
  if (!sameClassification) return false;
  const similarity = 1 - levenshteinDistance(left, right) / Math.max(left.length, right.length);
  return similarity >= 0.92;
}

export function suggestItemGroupCandidates(db: Database.Database, itemId: number): Record<string, unknown>[] {
  const source = db.prepare(`
    SELECT id, title, original_filename, transcription_normalized, transcription_diplomatic,
      media_type, date_start, date_end, date_precision
    FROM items WHERE id = ?
  `).get(itemId) as CandidateRow | undefined;
  if (!source) throw new ItemGroupError(404, 'item not found');
  const group = getItemGroupForItem(db, itemId) as { items?: { id: number }[] } | null;
  const excluded = new Set([itemId, ...(group?.items ?? []).map(({ id }) => id)]);
  const sourceFilename = filenameKey(source.original_filename);
  const sourceText = normalizedText(source.transcription_normalized ?? source.transcription_diplomatic);

  const candidates = db.prepare(`
    SELECT ${ITEM_SUMMARY_COLUMNS}, i.original_filename, i.transcription_normalized,
      i.transcription_diplomatic, i.description
    FROM items i
    ORDER BY i.created_at DESC, i.id DESC
  `).all() as CandidateRow[];

  return candidates.flatMap((candidate) => {
    if (excluded.has(candidate.id)) return [];
    const reasons: ('filename' | 'title' | 'transcription')[] = [];
    if (sourceFilename && sourceFilename === filenameKey(candidate.original_filename)) reasons.push('filename');
    if (titlesMatch(source, candidate)) reasons.push('title');
    const candidateText = normalizedText(candidate.transcription_normalized ?? candidate.transcription_diplomatic);
    if (sourceText && sourceText === candidateText) reasons.push('transcription');
    if (reasons.length === 0) return [];
    return [{
      item: Object.fromEntries(Object.entries(candidate).filter(([key]) => ![
        'original_filename', 'transcription_normalized', 'transcription_diplomatic', 'description',
      ].includes(key))),
      confidence: reasons.includes('transcription') || reasons.length > 1 ? 'likely' : 'possible',
      reasons,
    }];
  }).slice(0, 10);
}
