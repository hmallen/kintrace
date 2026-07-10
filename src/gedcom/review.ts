import type Database from 'better-sqlite3';
import { z } from 'zod';
import { PrecisionSchema } from '../../shared/api.js';

const PersonPayloadSchema = z.object({
  name: z.string().min(1),
  birthStart: z.string().nullable(),
  birthEnd: z.string().nullable(),
  birthPrecision: PrecisionSchema,
  deathStart: z.string().nullable(),
  deathEnd: z.string().nullable(),
  deathPrecision: PrecisionSchema,
  notes: z.string().nullable(),
});

const RelationshipPayloadSchema = z.object({
  personXref: z.string(),
  relatedPersonXref: z.string(),
  relationship: z.enum(['parent', 'child', 'spouse']),
});

const EventPayloadSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  dateStart: z.string().nullable(),
  dateEnd: z.string().nullable(),
  datePrecision: PrecisionSchema,
  personXref: z.string().nullable(),
  tag: z.string(),
  dateRaw: z.string().nullable(),
  sourceText: z.string().nullable(),
});

export const REVIEW_GROUPS = ['people', 'relationships', 'events'] as const;
export type ReviewGroup = (typeof REVIEW_GROUPS)[number];
export type ReviewAction = 'accept' | 'reject';

interface ReviewRow {
  id: number;
  gedcom_import_id: number;
  group_type: ReviewGroup;
  label: string;
  gedcom_xref: string | null;
  payload_json: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  reviewed_at: string | null;
}

export class GedcomReviewError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'GedcomReviewError';
  }
}

function serialize(row: ReviewRow) {
  return {
    id: row.id,
    importId: row.gedcom_import_id,
    group: row.group_type,
    label: row.label,
    gedcomXref: row.gedcom_xref,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

function getRow(db: Database.Database, id: number): ReviewRow {
  const row = db.prepare('SELECT * FROM gedcom_review_items WHERE id = ?').get(id) as ReviewRow | undefined;
  if (!row) throw new GedcomReviewError(404, 'GEDCOM review item not found');
  return row;
}

function resolvePerson(db: Database.Database, importId: number, xref: string): number {
  const row = db.prepare(
    `SELECT entity_id FROM gedcom_xrefs
     WHERE gedcom_import_id = ? AND gedcom_xref = ? AND entity_type = 'person'`
  ).get(importId, xref) as { entity_id: number | null } | undefined;
  if (row?.entity_id == null) {
    throw new GedcomReviewError(409, `Accept the person ${xref} before this item`);
  }
  return row.entity_id;
}

function materialize(db: Database.Database, row: ReviewRow): void {
  const rawPayload: unknown = JSON.parse(row.payload_json);
  if (row.group_type === 'people') {
    const payload = PersonPayloadSchema.parse(rawPayload);
    if (!row.gedcom_xref) throw new GedcomReviewError(422, 'Person review item is missing its GEDCOM xref');
    const result = db.prepare(
      `INSERT INTO people (
        name, birth_start, birth_end, birth_precision,
        death_start, death_end, death_precision, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      payload.name,
      payload.birthStart,
      payload.birthEnd,
      payload.birthPrecision,
      payload.deathStart,
      payload.deathEnd,
      payload.deathPrecision,
      payload.notes,
    );
    db.prepare(
      `INSERT INTO gedcom_xrefs (gedcom_import_id, gedcom_xref, entity_type, entity_id)
       VALUES (?, ?, 'person', ?)`
    ).run(row.gedcom_import_id, row.gedcom_xref, Number(result.lastInsertRowid));
    return;
  }

  if (row.group_type === 'relationships') {
    const payload = RelationshipPayloadSchema.parse(rawPayload);
    const personId = resolvePerson(db, row.gedcom_import_id, payload.personXref);
    const relatedPersonId = resolvePerson(db, row.gedcom_import_id, payload.relatedPersonXref);
    db.prepare(
      `INSERT OR IGNORE INTO person_relationships
       (person_id, related_person_id, relationship, gedcom_import_id) VALUES (?, ?, ?, ?)`
    ).run(personId, relatedPersonId, payload.relationship, row.gedcom_import_id);
    return;
  }

  const payload = EventPayloadSchema.parse(rawPayload);
  const personId = payload.personXref
    ? resolvePerson(db, row.gedcom_import_id, payload.personXref)
    : null;
  db.prepare(
    `INSERT INTO events (
      title, description, date_start, date_end, date_precision, person_id,
      gedcom_import_id, gedcom_xref, gedcom_tag, gedcom_date_raw, source_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    payload.title,
    payload.description,
    payload.dateStart,
    payload.dateEnd,
    payload.datePrecision,
    personId,
    row.gedcom_import_id,
    row.gedcom_xref,
    payload.tag,
    payload.dateRaw,
    payload.sourceText,
  );
}

export function listGedcomReviewQueue(db: Database.Database) {
  const rows = db.prepare(
    `SELECT * FROM gedcom_review_items
     ORDER BY gedcom_import_id, CASE group_type
       WHEN 'people' THEN 1 WHEN 'relationships' THEN 2 ELSE 3 END, id`
  ).all() as ReviewRow[];
  return {
    groups: REVIEW_GROUPS.map((group) => ({
      group,
      items: rows.filter((row) => row.group_type === group).map(serialize),
    })),
  };
}

export function reviewGedcomItem(db: Database.Database, id: number, action: ReviewAction) {
  return db.transaction(() => {
    const row = getRow(db, id);
    if (row.status !== 'pending') return serialize(row);
    if (action === 'accept') materialize(db, row);
    db.prepare(
      `UPDATE gedcom_review_items
       SET status = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).run(action === 'accept' ? 'accepted' : 'rejected', id);
    return serialize(getRow(db, id));
  })();
}

export function reviewGedcomGroup(
  db: Database.Database,
  group: ReviewGroup,
  action: ReviewAction,
) {
  return db.transaction(() => {
    const ids = db.prepare(
      `SELECT id FROM gedcom_review_items
       WHERE group_type = ? AND status = 'pending' ORDER BY id`
    ).all(group) as { id: number }[];
    return ids.map(({ id }) => reviewGedcomItem(db, id, action));
  })();
}
