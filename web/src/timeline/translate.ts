import type { ItemSummary, Precision } from '@shared/api.js';
import { buildTimelineTooltip } from './tooltip';

// Minimal HTML-escaper for text interpolated into markup vis-timeline renders
// as HTML (datum `content` and `title`). Shared with tooltip.ts.
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Fixed month names (no Intl) so labels are deterministic across environments.
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatDateLabel(dateStart: string | null, precision: Precision): string {
  if (dateStart === null || precision === 'unknown') return 'Undated';
  const [year = 0, month = 1, day = 1] = dateStart.split('-').map(Number);
  switch (precision) {
    case 'exact':
      return `${MONTHS[month - 1]} ${day}, ${year}`;
    case 'month':
      return `${MONTHS[month - 1]} ${year}`;
    case 'year':
      return String(year);
    case 'decade':
      return `c. ${Math.floor(year / 10) * 10}s`;
  }
}

export interface TimelineDatum {
  id: number;
  content: string; // formatDateLabel + title
  title: string; // buildTimelineTooltip HTML — vis renders it as the hover tooltip
  start: string; // date_start (ISO)
  end?: string; // date_end for ranges (month/year/decade)
  type: 'point' | 'range'; // exact -> point; month/year/decade -> range
  className: string; // `precision-<p> status-<s>` (space-joined)
}

export function toTimelineData(items: ItemSummary[]): {
  data: TimelineDatum[];
  undated: ItemSummary[];
} {
  const data: TimelineDatum[] = [];
  const undated: ItemSummary[] = [];

  for (const item of items) {
    // Null start wins: even a dated precision can't place an item without a start.
    if (item.date_start === null || item.date_precision === 'unknown') {
      undated.push(item);
      continue;
    }

    const content = `${formatDateLabel(item.date_start, item.date_precision)} — ${escapeHtml(
      item.title ?? 'Untitled',
    )}`;
    const title = buildTimelineTooltip(item);
    const className = `precision-${item.date_precision} status-${item.status}`;

    if (item.date_precision === 'exact') {
      data.push({ id: item.id, content, title, start: item.date_start, type: 'point', className });
    } else {
      data.push({
        id: item.id,
        content,
        title,
        start: item.date_start,
        end: item.date_end ?? item.date_start,
        type: 'range',
        className,
      });
    }
  }

  return { data, undated };
}
