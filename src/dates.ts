export type Precision = 'exact' | 'month' | 'year' | 'decade' | 'unknown';

export interface FuzzyDate {
  start: string | null;
  end: string | null;
  precision: Precision;
}

const PRECISIONS: Precision[] = ['exact', 'month', 'year', 'decade', 'unknown'];
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const UNKNOWN: FuzzyDate = { start: null, end: null, precision: 'unknown' };

function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function normalizeFuzzyDate(input: {
  start?: string | null;
  end?: string | null;
  precision?: string | null;
}): FuzzyDate {
  const precision = PRECISIONS.includes(input.precision as Precision)
    ? (input.precision as Precision)
    : 'unknown';
  const m = input.start ? ISO.exec(input.start) : null;
  if (!m || precision === 'unknown') return UNKNOWN;

  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (!isValidCalendarDate(year, month, day)) return UNKNOWN;

  const start = input.start!;
  const endMatch = input.end ? ISO.exec(input.end) : null;
  if (endMatch) {
    const [, ey, emo, ed] = endMatch;
    if (isValidCalendarDate(Number(ey), Number(emo), Number(ed)) && input.end! >= start) {
      return { start, end: input.end!, precision };
    }
  }

  switch (precision) {
    case 'exact':
      return { start, end: start, precision };
    case 'month':
      return { start: `${y}-${mo}-01`, end: lastDayOfMonth(year, month), precision };
    case 'year':
      return { start: `${y}-01-01`, end: `${year}-12-31`, precision };
    case 'decade': {
      const decadeStart = Math.floor(year / 10) * 10;
      return { start: `${decadeStart}-01-01`, end: `${decadeStart + 9}-12-31`, precision };
    }
  }
}
