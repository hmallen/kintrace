import { http, HttpResponse } from 'msw';
import type { ItemSummary } from '@shared/api.js';

// GET /api/items handler that filters by the `status` query param, like the
// real backend. (`personId` filtering needs link data a summary doesn't carry,
// so tests asserting person filters stub responses directly.)
export function itemsHandler(items: ItemSummary[]) {
  return http.get('/api/items', ({ request }) => {
    const status = new URL(request.url).searchParams.get('status');
    return HttpResponse.json(
      status === null ? items : items.filter((item) => item.status === status),
    );
  });
}

// Relative base paths — MSW intercepts the same relative URLs apiFetch builds.
export const handlers = [
  itemsHandler([]),
  http.get('/api/people', () => HttpResponse.json([])),
];
