import type { EventSummary, ItemSummary } from '@shared/api.js';
import {
  clusterLayout,
  layoutTimeline,
  toEntries,
  type TimelineEntry,
} from './layout';

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

function makeEvent(overrides: Partial<EventSummary>): EventSummary {
  return {
    id: 5,
    title: 'Birth of John Smith',
    description: null,
    date_start: '1901-01-01',
    date_end: '1901-12-31',
    date_precision: 'year',
    person_id: 1,
    source_type: 'gedcom',
    gedcom_import_id: 1,
    gedcom_xref: '@I1@',
    gedcom_tag: 'BIRT',
    gedcom_date_raw: '1901',
    source_text: null,
    ...overrides,
  };
}

function entry(overrides: Partial<TimelineEntry>): TimelineEntry {
  const startMs = Date.UTC(1943, 4, 12);
  return {
    key: 'item-1',
    kind: 'item',
    id: 1,
    title: 'Letter from Grandpa',
    dateLabel: 'May 12, 1943',
    startMs,
    endMs: startMs,
    precision: 'exact',
    status: 'reviewed',
    mediaType: 'letter',
    ...overrides,
  };
}

function dayEntries(dates: string[], precision: TimelineEntry['precision'] = 'exact'): TimelineEntry[] {
  return dates.map((iso, i) => {
    const ms = Date.parse(`${iso}T00:00:00Z`);
    return entry({ key: `item-${i + 1}`, id: i + 1, startMs: ms, endMs: ms, precision });
  });
}

describe('toEntries', () => {
  it('routes null-start and unknown-precision items to undated', () => {
    const nullStart = makeItem({ id: 1, date_start: null, date_end: null, date_precision: 'year' });
    const unknown = makeItem({ id: 2, date_start: '1943-05-12', date_precision: 'unknown' });
    const dated = makeItem({ id: 3 });

    const { entries, undated } = toEntries([nullStart, unknown, dated], []);

    expect(entries.map((e) => e.key)).toEqual(['item-3']);
    expect(undated).toEqual([nullStart, unknown]);
  });

  it('drops undated events instead of putting them in the tray', () => {
    const { entries, undated } = toEntries([], [
      makeEvent({ date_start: null, date_end: null, date_precision: 'unknown' }),
    ]);

    expect(entries).toHaveLength(0);
    expect(undated).toHaveLength(0);
  });

  it('namespaces keys by kind and carries item metadata', () => {
    const { entries } = toEntries([makeItem({ id: 7 })], [makeEvent({ id: 5 })]);

    const keys = entries.map((e) => e.key);
    expect(keys).toContain('item-7');
    expect(keys).toContain('event-5');
    const item = entries.find((e) => e.key === 'item-7')!;
    expect(item).toMatchObject({ kind: 'item', id: 7, status: 'reviewed', mediaType: 'letter' });
    const event = entries.find((e) => e.key === 'event-5')!;
    expect(event.kind).toBe('event');
    expect(event.status).toBeUndefined();
  });

  it('sorts entries by start date across kinds', () => {
    const { entries } = toEntries(
      [makeItem({ id: 1, date_start: '1943-05-12', date_end: '1943-05-12' })],
      [makeEvent({ id: 5, date_start: '1901-01-01', date_end: '1901-12-31' })],
    );

    expect(entries.map((e) => e.key)).toEqual(['event-5', 'item-1']);
  });

  it('derives dateLabel from precision, including the circa form', () => {
    const { entries } = toEntries(
      [makeItem({ date_start: '1940-01-01', date_end: '1949-12-31', date_precision: 'decade' })],
      [],
    );

    expect(entries[0]!.dateLabel).toBe('c. 1940s');
  });

  it('falls back to the start date when date_end is null and to Untitled for null titles', () => {
    const { entries } = toEntries(
      [makeItem({ title: null, date_start: '1943-05-12', date_end: null })],
      [],
    );

    expect(entries[0]!.endMs).toBe(entries[0]!.startMs);
    expect(entries[0]!.title).toBe('Untitled');
  });
});

describe('layoutTimeline (chronological)', () => {
  it('maps positions linearly in time', () => {
    const entries = dayEntries(['1900-01-01', '1900-01-11']);
    const layout = layoutTimeline(entries, 'chronological', { pxPerDay: 2 });

    expect(layout.placed[0]!.startPx).toBe(0);
    expect(layout.placed[1]!.startPx).toBe(20);
  });

  it('keeps honest gaps: px distance is proportional to day distance', () => {
    const entries = dayEntries(['1900-01-01', '1901-01-01', '1950-01-01']);
    const layout = layoutTimeline(entries, 'chronological', { pxPerDay: 1 });

    const [a, b, c] = layout.placed;
    const firstGap = b!.startPx - a!.startPx; // ~365 days
    const secondGap = c!.startPx - b!.startPx; // ~49 years
    expect(firstGap).toBeGreaterThan(300);
    expect(secondGap / firstGap).toBeGreaterThan(40);
  });

  it('gives a year-precision entry its full Jan 1 to Dec 31 extent', () => {
    const start = Date.UTC(1943, 0, 1);
    const end = Date.UTC(1943, 11, 31);
    const layout = layoutTimeline(
      [entry({ startMs: start, endMs: end, precision: 'year' })],
      'chronological',
      { pxPerDay: 1 },
    );

    expect(layout.placed[0]!.endPx - layout.placed[0]!.startPx).toBe(364);
  });

  it('floors exact points at minSpanPx so they stay visible', () => {
    const layout = layoutTimeline(dayEntries(['1943-05-12']), 'chronological', {
      pxPerDay: 1,
      minSpanPx: 12,
    });

    expect(layout.placed[0]!.endPx - layout.placed[0]!.startPx).toBe(12);
  });

  it('defaults zoom so a decade spans roughly 900px', () => {
    const entries = dayEntries(['1900-01-01', '1910-01-01']);
    const layout = layoutTimeline(entries, 'chronological');

    const distance = layout.placed[1]!.startPx - layout.placed[0]!.startPx;
    expect(distance).toBeGreaterThan(700);
    expect(distance).toBeLessThan(1100);
  });

  it('reports a scrollable length covering the last entry', () => {
    const entries = dayEntries(['1900-01-01', '1950-06-15']);
    const layout = layoutTimeline(entries, 'chronological', { pxPerDay: 1 });

    const maxEnd = Math.max(...layout.placed.map((p) => p.endPx));
    expect(layout.lengthPx).toBeGreaterThanOrEqual(maxEnd);
  });

  it('handles an empty archive without NaN', () => {
    const layout = layoutTimeline([], 'chronological');

    expect(layout.placed).toEqual([]);
    expect(layout.ticks).toEqual([]);
    expect(layout.lengthPx).toBe(0);
    expect(layout.laneCount).toBe(0);
  });
});

describe('layoutTimeline (sequential)', () => {
  it('spaces entries evenly by order, ignoring gap size', () => {
    const entries = dayEntries(['1900-01-01', '1900-01-02', '1950-01-01']);
    const layout = layoutTimeline(entries, 'sequential', { stepPx: 100 });

    expect(layout.placed.map((p) => p.startPx)).toEqual([0, 100, 200]);
  });

  it('still draws a visible bounded span for uncertain entries', () => {
    const start = Date.UTC(1940, 0, 1);
    const layout = layoutTimeline(
      [
        entry({ key: 'item-1', startMs: start, endMs: Date.UTC(1949, 11, 31), precision: 'decade' }),
        entry({ key: 'item-2', startMs: Date.UTC(1950, 5, 1), endMs: Date.UTC(1950, 5, 1), precision: 'exact' }),
      ],
      'sequential',
      { stepPx: 100, minSpanPx: 10 },
    );

    const decade = layout.placed[0]!;
    const exact = layout.placed[1]!;
    expect(decade.endPx - decade.startPx).toBeGreaterThan(exact.endPx - exact.startPx);
    expect(decade.endPx - decade.startPx).toBeLessThanOrEqual(100);
    expect(exact.endPx - exact.startPx).toBe(10);
  });
});

describe('lane assignment', () => {
  it('gives overlapping extents different lanes and reuses lane 0 when free', () => {
    const overlapA = entry({
      key: 'item-1',
      startMs: Date.UTC(1940, 0, 1),
      endMs: Date.UTC(1949, 11, 31),
      precision: 'decade',
    });
    const overlapB = entry({
      key: 'item-2',
      startMs: Date.UTC(1943, 0, 1),
      endMs: Date.UTC(1943, 11, 31),
      precision: 'year',
    });
    const disjoint = entry({
      key: 'item-3',
      startMs: Date.UTC(1960, 0, 1),
      endMs: Date.UTC(1960, 0, 1),
      precision: 'exact',
    });

    const layout = layoutTimeline([overlapA, overlapB, disjoint], 'chronological', { pxPerDay: 1 });

    expect(layout.placed[0]!.lane).toBe(0);
    expect(layout.placed[1]!.lane).toBe(1);
    expect(layout.placed[2]!.lane).toBe(0);
    expect(layout.laneCount).toBe(2);
  });
});

describe('axis ticks', () => {
  it('emits a year tick per year for compact chronological ranges', () => {
    const entries = dayEntries(['1918-05-24', '1922-10-27']);
    const layout = layoutTimeline(entries, 'chronological', { pxPerDay: 1 });

    expect(layout.ticks.map((t) => t.label)).toEqual(['1918', '1919', '1920', '1921', '1922']);
    const positions = layout.ticks.map((t) => t.px);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('falls back to decade ticks for ranges beyond ~40 years', () => {
    const entries = dayEntries(['1880-01-01', '1960-01-01']);
    const layout = layoutTimeline(entries, 'chronological', { pxPerDay: 0.5 });

    expect(layout.ticks[0]!.label).toBe('1880s');
    expect(layout.ticks.map((t) => t.label)).toContain('1960s');
    expect(layout.ticks.length).toBeLessThan(12);
  });

  it('marks each year present in the data for sequential scale', () => {
    const entries = dayEntries(['1918-05-24', '1918-08-01', '1920-02-02']);
    const layout = layoutTimeline(entries, 'sequential', { stepPx: 100 });

    expect(layout.ticks).toEqual([
      { px: 0, label: '1918' },
      { px: 200, label: '1920' },
    ]);
  });
});

describe('clusterLayout', () => {
  it('collapses a crowded run of entries into one cluster node', () => {
    const dates = ['1923-01-01', '1923-01-02', '1923-01-03', '1923-01-04', '1923-01-05'];
    const layout = layoutTimeline(dayEntries(dates), 'chronological', { pxPerDay: 1, minSpanPx: 4 });

    const nodes = clusterLayout(layout, { thresholdPx: 48, minSize: 4 });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.type).toBe('cluster');
    const cluster = nodes[0]!.type === 'cluster' ? nodes[0]!.cluster : null;
    expect(cluster!.members).toHaveLength(5);
    expect(cluster!.startPx).toBe(0);
    expect(cluster!.endPx).toBeGreaterThan(cluster!.startPx);
  });

  it('leaves sparse entries as plain entry nodes in order', () => {
    const layout = layoutTimeline(
      dayEntries(['1900-01-01', '1920-01-01', '1940-01-01']),
      'chronological',
      { pxPerDay: 1 },
    );

    const nodes = clusterLayout(layout, { thresholdPx: 48, minSize: 4 });

    expect(nodes.map((n) => n.type)).toEqual(['entry', 'entry', 'entry']);
    const keys = nodes.map((n) => (n.type === 'entry' ? n.placed.entry.key : ''));
    expect(keys).toEqual(['item-1', 'item-2', 'item-3']);
  });

  it('keeps crowded runs smaller than minSize as plain entries', () => {
    const layout = layoutTimeline(
      dayEntries(['1923-01-01', '1923-01-02', '1923-01-03']),
      'chronological',
      { pxPerDay: 1, minSpanPx: 4 },
    );

    const nodes = clusterLayout(layout, { thresholdPx: 48, minSize: 4 });

    expect(nodes.every((n) => n.type === 'entry')).toBe(true);
  });

  it('mixes clusters and singletons while preserving axis order', () => {
    const layout = layoutTimeline(
      dayEntries(['1923-01-01', '1923-01-02', '1923-01-03', '1923-01-04', '1950-01-01']),
      'chronological',
      { pxPerDay: 1, minSpanPx: 4 },
    );

    const nodes = clusterLayout(layout, { thresholdPx: 48, minSize: 4 });

    expect(nodes.map((n) => n.type)).toEqual(['cluster', 'entry']);
  });

  it('handles a 1,000-entry archive without falling over', () => {
    const dates: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const year = 1850 + (i % 150);
      const month = String((i % 12) + 1).padStart(2, '0');
      dates.push(`${year}-${month}-15`);
    }
    const { entries } = toEntries(
      dates.map((date_start, i) =>
        makeItem({ id: i + 1, date_start, date_end: date_start, date_precision: 'exact' }),
      ),
      [],
    );

    const layout = layoutTimeline(entries, 'chronological');
    const nodes = clusterLayout(layout);

    expect(layout.placed).toHaveLength(1000);
    expect(layout.laneCount).toBeGreaterThan(0);
    expect(nodes.length).toBeLessThan(1000);
  });
});
