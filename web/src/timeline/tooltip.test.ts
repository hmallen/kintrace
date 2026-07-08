import type { ItemSummary } from '@shared/api.js';
import { buildTimelineTooltip } from './tooltip';

function makeItem(overrides: Partial<ItemSummary> = {}): ItemSummary {
  return {
    id: 7,
    title: 'Annual report',
    media_type: 'article',
    date_start: '1943-01-01',
    date_end: '1943-12-31',
    date_precision: 'year',
    status: 'transcribed',
    content_hash: 'hash7',
    thumb_path: null,
    ...overrides,
  };
}

describe('buildTimelineTooltip', () => {
  it('includes title, thumbnail, precision, range', () => {
    const html = buildTimelineTooltip(makeItem());

    expect(html).toContain('Annual report');
    expect(html).toContain('src="/api/items/7/thumbnail"');
    expect(html).toContain('1943'); // precision label for a year item
    expect(html).toContain('1943-01-01 – 1943-12-31'); // full range
  });

  it('exact shows single date', () => {
    const html = buildTimelineTooltip(
      makeItem({ date_start: '1943-05-12', date_end: '1943-05-12', date_precision: 'exact' }),
    );

    // The single date appears once — not as a "start – end" span.
    expect(html.match(/1943-05-12/g)).toHaveLength(1);
    expect(html).not.toContain('–');
  });

  it('escapes title', () => {
    const html = buildTimelineTooltip(makeItem({ title: 'Sneaky <b>bold</b> title' }));

    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('untitled fallback', () => {
    const html = buildTimelineTooltip(makeItem({ title: null }));

    expect(html).toContain('Untitled');
  });
});
