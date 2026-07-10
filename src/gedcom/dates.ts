import type { FuzzyDate, Precision } from '../../shared/dates.js';

export interface GedcomDateResult {
  raw: string;
  date: FuzzyDate;
  warning?: {
    code: string;
    message: string;
  };
}

const UNKNOWN: FuzzyDate = { start: null, end: null, precision: 'unknown' };
const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

function lastDay(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isValidDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function yearRange(year: number): FuzzyDate {
  return { start: `${year}-01-01`, end: `${year}-12-31`, precision: 'year' };
}

function parseSimpleDate(raw: string): FuzzyDate | null {
  const text = raw.trim().toUpperCase();
  const decade = /^(\d{3})0S$/.exec(text);
  if (decade) {
    const start = Number(`${decade[1]}0`);
    return { start: `${start}-01-01`, end: `${start + 9}-12-31`, precision: 'decade' };
  }

  const exact = /^(\d{1,2})\s+([A-Z]{3})\s+(\d{3,4})$/.exec(text);
  if (exact) {
    const day = Number(exact[1]);
    const month = MONTHS[exact[2]!];
    const year = Number(exact[3]);
    if (month && isValidDate(year, Number(month), day)) {
      const iso = `${year}-${month}-${String(day).padStart(2, '0')}`;
      return { start: iso, end: iso, precision: 'exact' };
    }
  }

  const monthYear = /^([A-Z]{3})\s+(\d{3,4})$/.exec(text);
  if (monthYear) {
    const month = MONTHS[monthYear[1]!];
    const year = Number(monthYear[2]);
    if (month) {
      return {
        start: `${year}-${month}-01`,
        end: lastDay(year, Number(month)),
        precision: 'month',
      };
    }
  }

  const year = /^(\d{3,4})$/.exec(text);
  if (year) return yearRange(Number(year[1]));

  return null;
}

function withBounds(startDate: FuzzyDate, endDate: FuzzyDate, precision: Precision): FuzzyDate {
  return {
    start: startDate.start,
    end: endDate.end,
    precision,
  };
}

function unsupported(raw: string): GedcomDateResult {
  return {
    raw,
    date: UNKNOWN,
    warning: {
      code: 'unsupported_date',
      message: `Could not map GEDCOM date "${raw}" to a KinTrace fuzzy date.`,
    },
  };
}

export function parseGedcomDate(rawDate: string): GedcomDateResult {
  const raw = rawDate.trim();
  if (raw === '') return unsupported(rawDate);

  const upper = raw.toUpperCase();
  const stripped = /^(ABT|ABOUT|EST|CAL)\s+(.+)$/.exec(upper);
  const simple = parseSimpleDate(stripped?.[2] ?? upper);
  if (simple) return { raw, date: simple };

  const before = /^BEF\s+(.+)$/.exec(upper);
  if (before) {
    const parsed = parseSimpleDate(before[1]!);
    if (parsed?.start && parsed.precision === 'year') {
      const year = Number(parsed.start.slice(0, 4)) - 1;
      return { raw, date: { start: null, end: `${year}-12-31`, precision: 'year' } };
    }
  }

  const after = /^AFT\s+(.+)$/.exec(upper);
  if (after) {
    const parsed = parseSimpleDate(after[1]!);
    if (parsed?.start && parsed.precision === 'year') {
      const year = Number(parsed.start.slice(0, 4)) + 1;
      return { raw, date: { start: `${year}-01-01`, end: null, precision: 'year' } };
    }
  }

  const between = /^BET\s+(.+)\s+AND\s+(.+)$/.exec(upper);
  if (between) {
    const start = parseSimpleDate(between[1]!);
    const end = parseSimpleDate(between[2]!);
    if (start?.start && end?.end) return { raw, date: withBounds(start, end, start.precision) };
  }

  const fromTo = /^FROM\s+(.+)\s+TO\s+(.+)$/.exec(upper);
  if (fromTo) {
    const start = parseSimpleDate(fromTo[1]!);
    const end = parseSimpleDate(fromTo[2]!);
    if (start?.start && end?.end) return { raw, date: withBounds(start, end, start.precision) };
  }

  return unsupported(raw);
}
