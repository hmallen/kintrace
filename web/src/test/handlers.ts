import { http, HttpResponse } from 'msw';

// Relative base paths — MSW intercepts the same relative URLs apiFetch builds.
export const handlers = [
  http.get('/api/items', () => HttpResponse.json([])),
];
