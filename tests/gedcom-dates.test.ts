import { describe, expect, it } from 'vitest';
import { parseGedcomDate } from '../src/gedcom/dates.js';

describe('parseGedcomDate', () => {
  it.each([
    ['12 MAY 1901', { start: '1901-05-12', end: '1901-05-12', precision: 'exact' }],
    ['MAY 1901', { start: '1901-05-01', end: '1901-05-31', precision: 'month' }],
    ['1901', { start: '1901-01-01', end: '1901-12-31', precision: 'year' }],
    ['1900S', { start: '1900-01-01', end: '1909-12-31', precision: 'decade' }],
    ['ABT 1901', { start: '1901-01-01', end: '1901-12-31', precision: 'year' }],
    ['BEF 1901', { start: null, end: '1900-12-31', precision: 'year' }],
    ['AFT 1901', { start: '1902-01-01', end: null, precision: 'year' }],
    ['BET 1901 AND 1903', { start: '1901-01-01', end: '1903-12-31', precision: 'year' }],
    ['FROM 1901 TO 1903', { start: '1901-01-01', end: '1903-12-31', precision: 'year' }],
  ] as const)('maps %s to KinTrace fuzzy dates', (raw, expected) => {
    expect(parseGedcomDate(raw).date).toEqual(expected);
    expect(parseGedcomDate(raw).warning).toBeUndefined();
  });

  it('returns unknown precision with a warning for unsupported dates', () => {
    expect(parseGedcomDate('SPRING 1901')).toEqual({
      raw: 'SPRING 1901',
      date: { start: null, end: null, precision: 'unknown' },
      warning: {
        code: 'unsupported_date',
        message: 'Could not map GEDCOM date "SPRING 1901" to a KinTrace fuzzy date.',
      },
    });
  });
});
