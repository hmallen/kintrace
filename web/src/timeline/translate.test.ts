import type { ItemSummary } from '@shared/api.js';
import { formatDateLabel, toTimelineData } from './translate';

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

function makeItem(overrides: Partial<ItemSummary>): ItemSummary {
  return {
    id: 1,
    title: 'Letter from Grandpa',
    media_type: 'letter',
    date_start: '1943-05-12',
    date_end: '1943-05-12',
    date_precision: 'exact',
    status: 'reviewed',
    content_hash: 'hash1',
    thumb_path: null,
    ...overrides,
  };
}

describe('toTimelineData', () => {
  it('maps exact precision to a point', () => {
    const { data, undated } = toTimelineData([makeItem({})]);

    expect(undated).toHaveLength(0);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ type: 'point', start: '1943-05-12' });
    expect(data[0]!.className).toContain('precision-exact');
    expect(data[0]!.className).toContain('status-reviewed');
  });

  it('maps year precision to a range', () => {
    const { data } = toTimelineData([
      makeItem({ date_start: '1943-01-01', date_end: '1943-12-31', date_precision: 'year' }),
    ]);

    expect(data[0]).toMatchObject({
      type: 'range',
      start: '1943-01-01',
      end: '1943-12-31',
    });
    expect(data[0]!.className).toContain('precision-year');
  });

  it('maps decade precision to a range spanning the decade', () => {
    const { data } = toTimelineData([
      makeItem({ date_start: '1940-01-01', date_end: '1949-12-31', date_precision: 'decade' }),
    ]);

    expect(data[0]).toMatchObject({
      type: 'range',
      start: '1940-01-01',
      end: '1949-12-31',
    });
    expect(data[0]!.className).toContain('precision-decade');
  });

  it('routes unknown-precision items to undated', () => {
    const { data, undated } = toTimelineData([
      makeItem({ date_start: null, date_end: null, date_precision: 'unknown' }),
    ]);

    expect(data).toHaveLength(0);
    expect(undated).toHaveLength(1);
  });

  it('routes null date_start to undated even with a dated precision', () => {
    const item = makeItem({ date_start: null, date_end: null, date_precision: 'year' });
    const { data, undated } = toTimelineData([item]);

    expect(data).toHaveLength(0);
    expect(undated).toHaveLength(1);
    expect(undated[0]).toBe(item);
  });

  it('builds the content label from formatDateLabel and the title', () => {
    const { data } = toTimelineData([
      makeItem({
        title: 'Wedding announcement',
        date_start: '1943-01-01',
        date_end: '1943-12-31',
        date_precision: 'year',
      }),
    ]);

    expect(data[0]!.content).toBe('1943 — Wedding announcement');
  });

  it('includes the status token in the className', () => {
    const { data } = toTimelineData([makeItem({ status: 'pending' })]);

    expect(data[0]!.className).toContain('status-pending');
  });
});
