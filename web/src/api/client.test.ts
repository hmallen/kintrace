import { http, HttpResponse } from 'msw';
import { ZodError } from 'zod';
import { ItemDetailSchema, ItemSummarySchema } from '@shared/api.js';
import type { ItemSummary } from '@shared/api.js';
import { server } from '../test/msw';
import { ApiError, apiFetch, apiSend } from './client';

const item: ItemSummary = {
  id: 1,
  title: 'Letter from Grandpa',
  media_type: 'letter',
  date_start: null,
  date_end: null,
  date_precision: 'unknown',
  status: 'pending',
  content_hash: 'abc123',
  thumb_path: null,
};

describe('apiFetch', () => {
  it('parses a valid body', async () => {
    server.use(http.get('/api/items', () => HttpResponse.json([item])));

    await expect(apiFetch('/api/items', ItemSummarySchema.array())).resolves.toEqual([item]);
  });

  it('throws ApiError on 404 with server message', async () => {
    server.use(
      http.get('/api/items/999', () => HttpResponse.json({ error: 'not found' }, { status: 404 })),
    );

    const err = await apiFetch('/api/items/999', ItemDetailSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).serverMessage).toBe('not found');
  });

  it('throws ApiError on 409', async () => {
    server.use(
      http.get('/api/items/1', () =>
        HttpResponse.json({ error: 'item not transcribed yet' }, { status: 409 }),
      ),
    );

    const err = await apiFetch('/api/items/1', ItemDetailSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).serverMessage).toBe('item not transcribed yet');
  });

  it('rejects on schema mismatch', async () => {
    server.use(http.get('/api/items', () => HttpResponse.json({ nope: 1 })));

    const err = await apiFetch('/api/items', ItemSummarySchema.array()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZodError);
    expect(err).not.toBeInstanceOf(ApiError);
  });
});

describe('apiSend', () => {
  it('apiSend resolves on 204', async () => {
    server.use(
      http.post('/api/items/1/people', () => new HttpResponse(null, { status: 204 })),
    );

    await expect(
      apiSend('/api/items/1/people', {
        method: 'POST',
        body: JSON.stringify({ personId: 1, role: 'subject' }),
      }),
    ).resolves.toBeUndefined();
  });
});
