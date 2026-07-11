import { formatDateLabel } from './translate';

describe('formatDateLabel', () => {
  it('formats exact dates as "Month D, YYYY"', () => {
    expect(formatDateLabel('1943-05-12', 'exact')).toBe('May 12, 1943');
  });

  it('formats month precision as "Month YYYY"', () => {
    expect(formatDateLabel('1943-05-01', 'month')).toBe('May 1943');
  });

  it('formats year precision as "YYYY"', () => {
    expect(formatDateLabel('1943-01-01', 'year')).toBe('1943');
  });

  it('formats decade precision as "c. YYYYs"', () => {
    expect(formatDateLabel('1940-01-01', 'decade')).toBe('c. 1940s');
  });

  it('returns "Undated" for unknown precision or a null date', () => {
    expect(formatDateLabel(null, 'unknown')).toBe('Undated');
    expect(formatDateLabel('1943-05-12', 'unknown')).toBe('Undated');
  });
});
