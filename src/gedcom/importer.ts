import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type Database from 'better-sqlite3';
import type { FuzzyDate } from '../../shared/dates.js';
import { parseGedcomDate } from './dates.js';
import { type GedcomNode, type GedcomWarning, parseGedcom } from './parser.js';

export interface GedcomImportCounts {
  peopleQueued: number;
  relationshipsQueued: number;
  eventsQueued: number;
  warnings: number;
}

export interface GedcomImportResult {
  importId: number;
  duplicate: boolean;
  counts: GedcomImportCounts;
  warnings: GedcomWarning[];
}

export interface GedcomImportOptions {
  archiveDir: string;
  originalFilename: string;
}

export class GedcomImportError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'GedcomImportError';
    this.statusCode = statusCode;
  }
}

interface PersonImport {
  xref: string;
  name: string;
  birth: Fact | null;
  death: Fact | null;
  notes: string[];
  sourceText: string | null;
  node: GedcomNode;
}

interface FamilyImport {
  xref: string;
  husband?: string;
  wife?: string;
  children: string[];
  facts: Fact[];
}

interface Fact {
  tag: string;
  value?: string;
  dateRaw?: string;
  date: FuzzyDate;
  place?: string;
  note?: string;
  sourceText?: string;
  line: number;
}

const EMPTY_COUNTS: GedcomImportCounts = {
  peopleQueued: 0,
  relationshipsQueued: 0,
  eventsQueued: 0,
  warnings: 0,
};

const PERSON_EVENT_TAGS: Record<string, string> = {
  BIRT: 'Birth',
  DEAT: 'Death',
  RESI: 'Residence',
  CENS: 'Census',
  IMMI: 'Immigration',
  EMIG: 'Emigration',
  OCCU: 'Occupation',
  MILI: 'Military service',
  BURI: 'Burial',
  CHR: 'Christening',
  BAPM: 'Baptism',
  GRAD: 'Graduation',
  PROB: 'Probate',
  NATU: 'Naturalization',
  EVEN: 'Event',
};

const FAMILY_EVENT_TAGS: Record<string, string> = {
  MARR: 'Marriage',
  DIV: 'Divorce',
  EVEN: 'Family event',
};

async function hashFile(sourcePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(sourcePath), hash);
  return hash.digest('hex');
}

function child(node: GedcomNode, tag: string): GedcomNode | undefined {
  return node.children.find((candidate) => candidate.tag === tag);
}

function children(node: GedcomNode, tag: string): GedcomNode[] {
  return node.children.filter((candidate) => candidate.tag === tag);
}

function cleanName(value: string | undefined, xref: string): string {
  const name = (value ?? `Unnamed person ${xref}`).replace(/\//g, '').replace(/\s+/g, ' ').trim();
  return name === '' ? `Unnamed person ${xref}` : name;
}

function nodeText(node: GedcomNode): string | null {
  const parts = [node.value, ...children(node, 'TEXT').map((text) => text.value)].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  );
  return parts.length ? parts.join('\n') : null;
}

function sourceText(node: GedcomNode): string | null {
  const parts = children(node, 'SOUR')
    .map(nodeText)
    .filter((part): part is string => part !== null);
  return parts.length ? parts.join('\n') : null;
}

function factFromNode(node: GedcomNode, warnings: GedcomWarning[]): Fact {
  const dateNode = child(node, 'DATE');
  const dateRaw = dateNode?.value?.trim();
  const parsed = dateRaw ? parseGedcomDate(dateRaw) : null;
  if (parsed?.warning) {
    warnings.push({ line: dateNode?.line, ...parsed.warning });
  }
  return {
    tag: node.tag,
    value: node.value,
    dateRaw,
    date: parsed?.date ?? { start: null, end: null, precision: 'unknown' },
    place: child(node, 'PLAC')?.value,
    note: child(node, 'NOTE')?.value,
    sourceText: sourceText(node) ?? undefined,
    line: node.line,
  };
}

function decodeGedcom(buffer: Buffer): string {
  let text: string;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    text = buffer.subarray(2).toString('utf16le');
  } else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1]!;
      swapped[i - 1] = buffer[i]!;
    }
    text = swapped.toString('utf16le');
  } else {
    text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  }

  const charMatch = /^\d+\s+CHAR\s+(.+)$/im.exec(text);
  if (charMatch && charMatch[1]!.trim().toUpperCase() === 'ANSEL') {
    throw new GedcomImportError(415, 'GEDCOM character encoding ANSEL is not supported');
  }
  return text;
}

function buildPerson(record: GedcomNode, warnings: GedcomWarning[]): PersonImport {
  const name = cleanName(child(record, 'NAME')?.value, record.xref!);
  const facts = record.children.map((node) => factFromNode(node, warnings));
  const notes = children(record, 'NOTE')
    .map((note) => note.value?.trim())
    .filter((note): note is string => Boolean(note));
  const aliases = children(record, 'NAME')
    .slice(1)
    .map((nameNode) => cleanName(nameNode.value, record.xref!));
  if (aliases.length) notes.push(`Aliases: ${aliases.join(', ')}`);

  return {
    xref: record.xref!,
    name,
    birth: facts.find((fact) => fact.tag === 'BIRT') ?? null,
    death: facts.find((fact) => fact.tag === 'DEAT') ?? null,
    notes,
    sourceText: sourceText(record),
    node: record,
  };
}

function buildFamily(record: GedcomNode, warnings: GedcomWarning[]): FamilyImport {
  return {
    xref: record.xref!,
    husband: child(record, 'HUSB')?.value,
    wife: child(record, 'WIFE')?.value,
    children: children(record, 'CHIL')
      .map((node) => node.value)
      .filter((value): value is string => Boolean(value)),
    facts: record.children
      .filter((node) => FAMILY_EVENT_TAGS[node.tag] !== undefined)
      .map((node) => factFromNode(node, warnings)),
  };
}

function notesText(notes: string[], source: string | null): string | null {
  const parts: string[] = [];
  if (notes.length) parts.push(`GEDCOM notes:\n${notes.join('\n')}`);
  if (source) parts.push(`GEDCOM sources:\n${source}`);
  return parts.length ? parts.join('\n\n') : null;
}

function enqueueReviewItem(
  db: Database.Database,
  params: {
    importId: number;
    group: 'people' | 'relationships' | 'events';
    label: string;
    xref?: string;
    payload: Record<string, unknown>;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO gedcom_review_items (
        gedcom_import_id, group_type, label, gedcom_xref, payload_json
      ) VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      params.importId,
      params.group,
      params.label,
      params.xref ?? null,
      JSON.stringify(params.payload),
    );
  return Number(result.lastInsertRowid);
}

function eventPayload(
  title: string,
  fact: Fact,
  personXref: string | null,
): Record<string, unknown> {
  return {
    title,
    description: factDescription(fact),
    dateStart: fact.date.start,
    dateEnd: fact.date.end,
    datePrecision: fact.date.precision,
    personXref,
    tag: fact.tag,
    dateRaw: fact.dateRaw ?? null,
    sourceText: fact.sourceText ?? null,
  };
}

function factDescription(fact: Fact): string | null {
  const parts = [fact.value, fact.place ? `Place: ${fact.place}` : null, fact.note].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  );
  return parts.length ? parts.join('\n') : null;
}

export async function importGedcomFile(
  db: Database.Database,
  sourcePath: string,
  opts: GedcomImportOptions,
): Promise<GedcomImportResult> {
  const ext = extname(opts.originalFilename).toLowerCase();
  if (ext !== '.ged' && ext !== '.gedcom') {
    throw new GedcomImportError(400, 'GEDCOM file must use .ged or .gedcom extension');
  }

  const buffer = await readFile(sourcePath);
  if (buffer.length === 0) throw new GedcomImportError(400, 'GEDCOM file is empty');

  const hash = await hashFile(sourcePath);
  const existing = db
    .prepare('SELECT id, counts_json, warnings_json FROM gedcom_imports WHERE content_hash = ?')
    .get(hash) as { id: number; counts_json: string; warnings_json: string } | undefined;
  if (existing) {
    return {
      importId: existing.id,
      duplicate: true,
      counts: JSON.parse(existing.counts_json) as GedcomImportCounts,
      warnings: JSON.parse(existing.warnings_json) as GedcomWarning[],
    };
  }

  const text = decodeGedcom(buffer);
  if (text.trim() === '') throw new GedcomImportError(400, 'GEDCOM file is empty');

  const parsed = parseGedcom(text);
  if (!parsed.records.some((record) => record.tag === 'INDI')) {
    throw new GedcomImportError(422, 'GEDCOM file does not contain any individual records');
  }

  await mkdir(opts.archiveDir, { recursive: true });
  const archivedPath = join(
    opts.archiveDir,
    `${hash.slice(0, 16)}-${randomBytes(4).toString('hex')}-${basename(opts.originalFilename)}`,
  );
  await copyFile(sourcePath, archivedPath);

  try {
    return db.transaction(() => {
      const warnings: GedcomWarning[] = [...parsed.warnings];
      const counts: GedcomImportCounts = { ...EMPTY_COUNTS };
      const importId = Number(
        db
          .prepare(
            'INSERT INTO gedcom_imports (original_filename, content_hash, archived_file_path, counts_json, warnings_json) VALUES (?, ?, ?, ?, ?)'
          )
          .run(opts.originalFilename, hash, archivedPath, JSON.stringify(counts), JSON.stringify(warnings))
          .lastInsertRowid,
      );

      const people = parsed.records.filter(
        (record): record is GedcomNode & { xref: string } => record.tag === 'INDI' && Boolean(record.xref),
      );
      const families = parsed.records.filter(
        (record): record is GedcomNode & { xref: string } => record.tag === 'FAM' && Boolean(record.xref),
      );
      const personXrefs = new Set(people.map((record) => record.xref));
      const personNames = new Map<string, string>();

      for (const record of people) {
        const person = buildPerson(record, warnings);
        personNames.set(person.xref, person.name);
        enqueueReviewItem(db, {
          importId,
          group: 'people',
          label: person.name,
          xref: person.xref,
          payload: {
            name: person.name,
            birthStart: person.birth?.date.start ?? null,
            birthEnd: person.birth?.date.end ?? null,
            birthPrecision: person.birth?.date.precision ?? 'unknown',
            deathStart: person.death?.date.start ?? null,
            deathEnd: person.death?.date.end ?? null,
            deathPrecision: person.death?.date.precision ?? 'unknown',
            notes: notesText(person.notes, person.sourceText),
          },
        });
        counts.peopleQueued += 1;

        for (const fact of [person.birth, person.death]) {
          if (!fact || fact.date.precision === 'unknown') continue;
          const label = PERSON_EVENT_TAGS[fact.tag];
          const title = `${label} of ${person.name}`;
          enqueueReviewItem(db, {
            importId,
            group: 'events',
            label: title,
            xref: person.xref,
            payload: eventPayload(title, fact, person.xref),
          });
          counts.eventsQueued += 1;
        }

        for (const factNode of record.children.filter((node) => PERSON_EVENT_TAGS[node.tag] !== undefined)) {
          if (factNode.tag === 'BIRT' || factNode.tag === 'DEAT') continue;
          const fact = factFromNode(factNode, warnings);
          if (fact.date.precision === 'unknown' && !fact.value && !fact.place && !fact.note) continue;
          const title = `${PERSON_EVENT_TAGS[fact.tag]} of ${person.name}`;
          enqueueReviewItem(db, {
            importId,
            group: 'events',
            label: title,
            xref: person.xref,
            payload: eventPayload(title, fact, person.xref),
          });
          counts.eventsQueued += 1;
        }
      }

      for (const record of families) {
        const family = buildFamily(record, warnings);

        const parents = [family.husband, family.wife].filter(
          (xref): xref is string => typeof xref === 'string' && personXrefs.has(xref),
        );
        for (const parent of parents) {
          for (const childXref of family.children) {
            if (!personXrefs.has(childXref)) continue;
            const label = `${personNames.get(parent) ?? parent} is parent of ${personNames.get(childXref) ?? childXref}`;
            enqueueReviewItem(db, {
              importId,
              group: 'relationships',
              label,
              xref: family.xref,
              payload: { personXref: parent, relatedPersonXref: childXref, relationship: 'parent' },
            });
            counts.relationshipsQueued += 1;
          }
        }

        if (family.husband && family.wife && personXrefs.has(family.husband) && personXrefs.has(family.wife)) {
          const label = `${personNames.get(family.husband) ?? family.husband} and ${personNames.get(family.wife) ?? family.wife} are spouses`;
          enqueueReviewItem(db, {
            importId,
            group: 'relationships',
            label,
            xref: family.xref,
            payload: {
              personXref: family.husband,
              relatedPersonXref: family.wife,
              relationship: 'spouse',
            },
          });
          counts.relationshipsQueued += 1;
        }

        for (const fact of family.facts) {
          if (fact.date.precision === 'unknown' && !fact.value && !fact.place && !fact.note) continue;
          const husband = family.husband ? personNames.get(family.husband) : undefined;
          const wife = family.wife ? personNames.get(family.wife) : undefined;
          const names = [husband, wife].filter((name): name is string => Boolean(name));
          const title = names.length
            ? `${FAMILY_EVENT_TAGS[fact.tag]} of ${names.join(' and ')}`
            : `${FAMILY_EVENT_TAGS[fact.tag]} ${family.xref}`;
          enqueueReviewItem(db, {
            importId,
            group: 'events',
            label: title,
            xref: family.xref,
            payload: eventPayload(title, fact, family.husband ?? null),
          });
          counts.eventsQueued += 1;
        }
      }

      counts.warnings = warnings.length;
      db.prepare('UPDATE gedcom_imports SET counts_json = ?, warnings_json = ? WHERE id = ?').run(
        JSON.stringify(counts),
        JSON.stringify(warnings),
        importId,
      );

      return { importId, duplicate: false, counts, warnings };
    })();
  } catch (err) {
    await rm(archivedPath, { force: true });
    throw err;
  }
}
