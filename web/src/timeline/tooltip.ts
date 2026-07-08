import type { ItemSummary } from '@shared/api.js';
import { escapeHtml, formatDateLabel } from './translate';

// Pure builder for the HTML string vis-timeline shows as an item's hover
// tooltip (the datum `title` property). Shows the item title, its thumbnail,
// the human precision label, and the raw ISO range — a single date for exact
// precision, `start – end` otherwise.
//
// Note: this module and translate.ts import each other (formatDateLabel here,
// buildTimelineTooltip there). Both are function-only modules with no
// top-level evaluation, so the cycle is harmless under ESM.
export function buildTimelineTooltip(item: ItemSummary): string {
  const title = escapeHtml(item.title ?? 'Untitled');
  const precision = escapeHtml(formatDateLabel(item.date_start, item.date_precision));
  const range =
    item.date_precision === 'exact' || item.date_end === null || item.date_end === item.date_start
      ? (item.date_start ?? '')
      : `${item.date_start} – ${item.date_end}`;

  return (
    `<div class="timeline-tooltip">` +
    `<img src="/api/items/${item.id}/thumbnail" alt="" />` +
    `<strong>${title}</strong>` +
    `<span class="tooltip-precision">${precision}</span>` +
    `<span class="tooltip-range">${escapeHtml(range)}</span>` +
    `</div>`
  );
}
