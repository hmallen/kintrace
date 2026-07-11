import type {
  EventSummary,
  ItemSummary,
  MediaType,
  Precision,
  Status,
} from '@shared/api.js';
import { formatDateLabel } from './translate';

export type Scale = 'chronological' | 'sequential';

export interface TimelineEntry {
  key: string; // 'item-3' | 'event-7' — unique across kinds
  kind: 'item' | 'event';
  id: number;
  title: string;
  dateLabel: string;
  startMs: number;
  endMs: number; // ≥ startMs; precision span end
  precision: Precision;
  status?: Status; // items only
  mediaType?: MediaType; // items only
}

export interface PlacedEntry {
  entry: TimelineEntry;
  startPx: number;
  endPx: number;
  lane: number;
}

export interface AxisTick {
  px: number;
  label: string;
}

export interface TimelineLayout {
  placed: PlacedEntry[]; // same order as the input entries
  ticks: AxisTick[];
  lengthPx: number;
  laneCount: number;
}

export interface Cluster {
  key: string;
  startPx: number;
  endPx: number;
  members: PlacedEntry[];
}

export type TimelineNode =
  | { type: 'entry'; placed: PlacedEntry }
  | { type: 'cluster'; cluster: Cluster };

const MS_PER_DAY = 86_400_000;
// Chronological zoom: a decade ≈ 900px of axis.
const DEFAULT_PX_PER_DAY = 900 / 3652.5;
const DEFAULT_STEP_PX = 180;
const DEFAULT_MIN_SPAN_PX = 10;
// Beyond this range, year ticks get too dense — switch to decades.
const DECADE_TICK_THRESHOLD_YEARS = 40;
const DEFAULT_CLUSTER_THRESHOLD_PX = 48;
const DEFAULT_CLUSTER_MIN_SIZE = 4;

function parseIsoUtc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

export function toEntries(
  items: ItemSummary[],
  events: EventSummary[],
): { entries: TimelineEntry[]; undated: ItemSummary[] } {
  const entries: TimelineEntry[] = [];
  const undated: ItemSummary[] = [];

  for (const item of items) {
    // Null start wins: even a dated precision can't place an item without a start.
    if (item.date_start === null || item.date_precision === 'unknown') {
      undated.push(item);
      continue;
    }
    const startMs = parseIsoUtc(item.date_start);
    entries.push({
      key: `item-${item.id}`,
      kind: 'item',
      id: item.id,
      title: item.title ?? 'Untitled',
      dateLabel: formatDateLabel(item.date_start, item.date_precision),
      startMs,
      endMs: item.date_end === null ? startMs : parseIsoUtc(item.date_end),
      precision: item.date_precision,
      status: item.status,
      mediaType: item.media_type,
    });
  }

  for (const event of events) {
    // Events have no tray — undated ones are simply not placeable.
    if (event.date_start === null || event.date_precision === 'unknown') continue;
    const startMs = parseIsoUtc(event.date_start);
    entries.push({
      key: `event-${event.id}`,
      kind: 'event',
      id: event.id,
      title: event.title,
      dateLabel: formatDateLabel(event.date_start, event.date_precision),
      startMs,
      endMs: event.date_end === null ? startMs : parseIsoUtc(event.date_end),
      precision: event.date_precision,
    });
  }

  entries.sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : 1));
  return { entries, undated };
}

interface LayoutOptions {
  pxPerDay?: number;
  stepPx?: number;
  minSpanPx?: number;
}

function assignLanes(sorted: { startPx: number; endPx: number; lane: number }[]): number {
  // Greedy first-fit over lanes ordered by axis position.
  const laneEnds: number[] = [];
  for (const p of sorted) {
    let lane = laneEnds.findIndex((end) => p.startPx >= end);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(p.endPx);
    } else {
      laneEnds[lane] = p.endPx;
    }
    p.lane = lane;
  }
  return laneEnds.length;
}

export function layoutTimeline(
  entries: TimelineEntry[],
  scale: Scale,
  opts: LayoutOptions = {},
): TimelineLayout {
  if (entries.length === 0) {
    return { placed: [], ticks: [], lengthPx: 0, laneCount: 0 };
  }
  const pxPerDay = opts.pxPerDay ?? DEFAULT_PX_PER_DAY;
  const stepPx = opts.stepPx ?? DEFAULT_STEP_PX;
  const minSpanPx = opts.minSpanPx ?? DEFAULT_MIN_SPAN_PX;

  const order = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.startMs - b.entry.startMs || (a.entry.key < b.entry.key ? -1 : 1));

  // Anchor the axis at Jan 1 of the earliest year so ticks start at px ≥ 0.
  const minStartMs = order[0]!.entry.startMs;
  const minYear = new Date(minStartMs).getUTCFullYear();
  const originMs = Date.UTC(minYear, 0, 1);

  const placed: PlacedEntry[] = new Array<PlacedEntry>(entries.length);
  const sortedPlaced: PlacedEntry[] = [];
  for (let seq = 0; seq < order.length; seq++) {
    const { entry, index } = order[seq]!;
    let startPx: number;
    let endPx: number;
    if (scale === 'chronological') {
      startPx = ((entry.startMs - originMs) / MS_PER_DAY) * pxPerDay;
      const spanPx = ((entry.endMs - entry.startMs) / MS_PER_DAY) * pxPerDay;
      endPx = startPx + Math.max(spanPx, minSpanPx);
    } else {
      startPx = seq * stepPx;
      // Uncertainty must stay visible, but a literal decade would swallow the
      // sequential ordering — draw a fixed, clearly-bounded span instead.
      const spanPx =
        entry.precision === 'exact'
          ? minSpanPx
          : Math.min(stepPx, Math.max(minSpanPx, Math.round(stepPx * 0.6)));
      endPx = startPx + spanPx;
    }
    const p: PlacedEntry = { entry, startPx, endPx, lane: 0 };
    placed[index] = p;
    sortedPlaced.push(p);
  }

  const laneCount = assignLanes(sortedPlaced);
  const lengthPx = Math.max(...sortedPlaced.map((p) => p.endPx));

  const ticks: AxisTick[] = [];
  if (scale === 'chronological') {
    const maxEndMs = Math.max(...entries.map((e) => e.endMs));
    const maxYear = new Date(maxEndMs).getUTCFullYear();
    const decades = maxYear - minYear > DECADE_TICK_THRESHOLD_YEARS;
    const step = decades ? 10 : 1;
    const firstTickYear = decades ? Math.floor(minYear / 10) * 10 : minYear;
    for (let year = firstTickYear; year <= maxYear; year += step) {
      ticks.push({
        px: ((Date.UTC(year, 0, 1) - originMs) / MS_PER_DAY) * pxPerDay,
        label: decades ? `${year}s` : String(year),
      });
    }
  } else {
    let lastYear: number | null = null;
    for (const p of sortedPlaced) {
      const year = new Date(p.entry.startMs).getUTCFullYear();
      if (year !== lastYear) {
        ticks.push({ px: p.startPx, label: String(year) });
        lastYear = year;
      }
    }
  }

  return { placed, ticks, lengthPx, laneCount };
}

export function clusterLayout(
  layout: TimelineLayout,
  opts: { thresholdPx?: number; minSize?: number } = {},
): TimelineNode[] {
  const thresholdPx = opts.thresholdPx ?? DEFAULT_CLUSTER_THRESHOLD_PX;
  const minSize = opts.minSize ?? DEFAULT_CLUSTER_MIN_SIZE;

  const sorted = [...layout.placed].sort(
    (a, b) => a.startPx - b.startPx || (a.entry.key < b.entry.key ? -1 : 1),
  );

  const nodes: TimelineNode[] = [];
  let run: PlacedEntry[] = [];

  const flush = () => {
    if (run.length >= minSize) {
      nodes.push({
        type: 'cluster',
        cluster: {
          key: `cluster-${run[0]!.entry.key}`,
          startPx: run[0]!.startPx,
          endPx: Math.max(...run.map((p) => p.endPx)),
          members: run,
        },
      });
    } else {
      for (const p of run) nodes.push({ type: 'entry', placed: p });
    }
    run = [];
  };

  for (const p of sorted) {
    const prev = run[run.length - 1];
    if (prev !== undefined && p.startPx - prev.startPx >= thresholdPx) flush();
    run.push(p);
  }
  flush();

  return nodes;
}
