import { http, HttpResponse } from 'msw';
import type {
  ImportResult,
  EventSummary,
  ItemDetail,
  ItemSummary,
  Person,
  QueueResult,
  TimelineStoryState,
} from '@shared/api.js';

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

export function eventsHandler(events: EventSummary[]) {
  return http.get('/api/events', () => HttpResponse.json(events));
}

// GET /api/people handler serving a fixed people list.
export function peopleHandler(people: Person[]) {
  return http.get('/api/people', () => HttpResponse.json(people));
}

export const emptyStoryState: TimelineStoryState = {
  story: null,
  sources: [],
  generatedAt: null,
  model: null,
  storySourceCount: 0,
  eligibleSourceCount: 0,
  stale: false,
  canGenerate: false,
  unavailableReason: 'no_reviewed_media',
};

// Relative base paths — MSW intercepts the same relative URLs apiFetch builds.
export const handlers = [
  http.get('/api/timeline/story', () => HttpResponse.json(emptyStoryState)),
  http.get('/api/items/:id/group-suggestions', () => HttpResponse.json([])),
  http.get('/api/item-groups', () => HttpResponse.json([])),
  itemsHandler([]),
  uploadHandler([]),
  queueProcessHandler({ processed: 0, failed: 0 }),
  // Default: no item exists until a test stubs one (keeps navigation tests
  // from tripping onUnhandledRequest while the Workspace route fetches).
  http.get('/api/items/:id', () =>
    HttpResponse.json({ error: 'item not found' }, { status: 404 }),
  ),
  eventsHandler([]),
  peopleHandler([]),
];
