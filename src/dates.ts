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

  const [, y, mo] = m;
  const year = Number(y);
  const start = input.start!;
  if (input.end && ISO.test(input.end)) return { start, end: input.end, precision };

  switch (precision) {
    case 'exact':
      return { start, end: start, precision };
    case 'month':
      return { start, end: lastDayOfMonth(year, Number(mo)), precision };
    case 'year':
      return { start, end: `${year}-12-31`, precision };
    case 'decade': {
      const decadeStart = Math.floor(year / 10) * 10;
      return { start, end: `${decadeStart + 9}-12-31`, precision };
    }
  }
}
