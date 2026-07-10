import type Database from 'better-sqlite3';

interface PersonRow {
  id: number;
  name: string;
  birth_start: string | null;
  birth_end: string | null;
  birth_precision: string;
  death_start: string | null;
  death_end: string | null;
  death_precision: string;
  notes: string | null;
}

export class MergePeopleError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'MergePeopleError';
  }
}

function combinedNotes(kept: string | null, duplicate: string | null): string | null {
  const parts = [kept, duplicate]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set(parts)].join('\n\n') || null;
}

/** Merge duplicateId into keepId, preserving every reference to either person. */
export function mergePeople(
  db: Database.Database,
  keepId: number,
  duplicateId: number,
): { id: number; name: string; notes: string | null } {
  if (keepId === duplicateId) {
    throw new MergePeopleError(400, 'keepId and duplicateId must be different');
  }

  return db.transaction(() => {
    const getPerson = db.prepare('SELECT * FROM people WHERE id = ?');
    const kept = getPerson.get(keepId) as PersonRow | undefined;
    const duplicate = getPerson.get(duplicateId) as PersonRow | undefined;
    if (!kept) throw new MergePeopleError(404, 'person to keep not found');
    if (!duplicate) throw new MergePeopleError(404, 'duplicate person not found');

    db.prepare(
      `UPDATE people SET
        birth_start = ?, birth_end = ?, birth_precision = ?,
        death_start = ?, death_end = ?, death_precision = ?, notes = ?
       WHERE id = ?`,
    ).run(
      kept.birth_start ?? duplicate.birth_start,
      kept.birth_end ?? duplicate.birth_end,
      kept.birth_start ? kept.birth_precision : duplicate.birth_precision,
      kept.death_start ?? duplicate.death_start,
      kept.death_end ?? duplicate.death_end,
      kept.death_start ? kept.death_precision : duplicate.death_precision,
      combinedNotes(kept.notes, duplicate.notes),
      keepId,
    );

    // Copy first so a duplicate item/role association can be ignored safely.
    db.prepare(
      `INSERT OR IGNORE INTO item_people (item_id, person_id, role)
       SELECT item_id, ?, role FROM item_people WHERE person_id = ?`,
    ).run(keepId, duplicateId);
    db.prepare('DELETE FROM item_people WHERE person_id = ?').run(duplicateId);

    db.prepare('UPDATE events SET person_id = ? WHERE person_id = ?').run(keepId, duplicateId);
    db.prepare(
      `UPDATE gedcom_xrefs SET entity_id = ?
       WHERE entity_type = 'person' AND entity_id = ?`,
    ).run(keepId, duplicateId);

    const relationships = db.prepare(
      `SELECT person_id, related_person_id, relationship, gedcom_import_id
       FROM person_relationships
       WHERE person_id = ? OR related_person_id = ?`,
    ).all(duplicateId, duplicateId) as Array<{
      person_id: number;
      related_person_id: number;
      relationship: string;
      gedcom_import_id: number | null;
    }>;
    db.prepare(
      'DELETE FROM person_relationships WHERE person_id = ? OR related_person_id = ?',
    ).run(duplicateId, duplicateId);
    const relationshipExists = db.prepare(
      `SELECT 1 FROM person_relationships
       WHERE person_id = ? AND related_person_id = ? AND relationship = ?
         AND gedcom_import_id IS ?`,
    );
    const insertRelationship = db.prepare(
      `INSERT INTO person_relationships
       (person_id, related_person_id, relationship, gedcom_import_id)
       VALUES (?, ?, ?, ?)`,
    );
    for (const relationship of relationships) {
      const personId = relationship.person_id === duplicateId ? keepId : relationship.person_id;
      const relatedPersonId = relationship.related_person_id === duplicateId
        ? keepId
        : relationship.related_person_id;
      if (
        personId !== relatedPersonId
        && !relationshipExists.get(
          personId,
          relatedPersonId,
          relationship.relationship,
          relationship.gedcom_import_id,
        )
      ) {
        insertRelationship.run(
          personId,
          relatedPersonId,
          relationship.relationship,
          relationship.gedcom_import_id,
        );
      }
    }

    db.prepare('DELETE FROM people WHERE id = ?').run(duplicateId);
    const merged = getPerson.get(keepId) as PersonRow;
    return { id: merged.id, name: merged.name, notes: merged.notes };
  })();
}
