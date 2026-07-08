import type { ItemSummary, Precision } from '@shared/api.js';

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

    const content = `${formatDateLabel(item.date_start, item.date_precision)} — ${
      item.title ?? 'Untitled'
    }`;
    const className = `precision-${item.date_precision} status-${item.status}`;

    if (item.date_precision === 'exact') {
      data.push({ id: item.id, content, start: item.date_start, type: 'point', className });
    } else {
      data.push({
        id: item.id,
        content,
        start: item.date_start,
        end: item.date_end ?? item.date_start,
        type: 'range',
        className,
      });
    }
  }

  return { data, undated };
}
