import { http, HttpResponse } from 'msw';
import type { ImportResult, ItemDetail, ItemSummary, QueueResult } from '@shared/api.js';

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

// GET /api/items/:id handler serving a fixed item detail.
export function itemDetailHandler(item: ItemDetail) {
  return http.get(`/api/items/${item.id}`, () => HttpResponse.json(item));
}

// POST /api/upload handler serving a fixed per-file ImportResult[].
export function uploadHandler(results: ImportResult[]) {
  return http.post('/api/upload', () => HttpResponse.json(results));
}

// POST /api/queue/process handler serving a fixed QueueResult.
export function queueProcessHandler(result: QueueResult) {
  return http.post('/api/queue/process', () => HttpResponse.json(result));
}

// Relative base paths — MSW intercepts the same relative URLs apiFetch builds.
export const handlers = [
  itemsHandler([]),
  uploadHandler([]),
  queueProcessHandler({ processed: 0, failed: 0 }),
  // Default: no item exists until a test stubs one (keeps navigation tests
  // from tripping onUnhandledRequest while the Workspace route fetches).
  http.get('/api/items/:id', () =>
    HttpResponse.json({ error: 'item not found' }, { status: 404 }),
  ),
  http.get('/api/people', () => HttpResponse.json([])),
];
