import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ItemDetail, ItemSummary, Person } from '@shared/api.js';
import { makeQueryClient } from '../queryClient';
import { server } from '../test/msw';
import {
  useCreatePerson,
  useItems,
  useLinkPerson,
  usePeople,
  useUpdateItem,
} from './hooks';

const summary: ItemSummary = {
  id: 1,
  title: 'Letter from Grandpa',
  media_type: 'letter',
  date_start: null,
  date_end: null,
  date_precision: 'unknown',
  status: 'transcribed',
  content_hash: 'abc123',
  thumb_path: null,
};

const detail: ItemDetail = {
  ...summary,
  file_path: 'archive/ab/abc123.jpg',
  created_at: '2026-07-01T00:00:00Z',
  description: null,
  transcription_diplomatic: 'Dear famly [?]',
  transcription_normalized: 'Dear family',
  ai_error: null,
  ai_names: null,
  ai_confidence: null,
  people: [],
};

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('useItems', () => {
  it('useItems passes filters into the query string', async () => {
    let requestedUrl = '';
    server.use(
      http.get('/api/items', ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json([summary]);
      }),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(() => useItems({ status: 'transcribed' }), {
      wrapper: wrapperFor(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedUrl).toContain('status=transcribed');
    expect(result.current.data).toEqual([summary]);
  });
});

describe('useUpdateItem', () => {
  it('useUpdateItem sends only provided fields', async () => {
    let capturedBody: unknown;
    server.use(
      http.patch('/api/items/1', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...detail, title: 'X' });
      }),
    );

    const qc = makeQueryClient();
    qc.setQueryData(['item', 1], detail);
    const { result } = renderHook(() => useUpdateItem(1), { wrapper: wrapperFor(qc) });

    await act(async () => {
      await result.current.mutateAsync({ title: 'X' });
    });

    expect(capturedBody).toEqual({ title: 'X' });
    expect(qc.getQueryData<ItemDetail>(['item', 1])?.title).toBe('X');
  });

  it("useUpdateItem approve sends {status:'reviewed'} only", async () => {
    let capturedBody: unknown;
    server.use(
      http.patch('/api/items/1', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...detail, status: 'reviewed' });
      }),
    );

    const qc = makeQueryClient();
    qc.setQueryData(['item', 1], detail);
    const { result } = renderHook(() => useUpdateItem(1), { wrapper: wrapperFor(qc) });

    await act(async () => {
      await result.current.mutateAsync({ status: 'reviewed' });
    });

    expect(capturedBody).toEqual({ status: 'reviewed' });
  });
});

describe('useCreatePerson', () => {
  it('useCreatePerson invalidates people', async () => {
    const people: Person[] = [{ id: 1, name: 'Ada', notes: null }];
    server.use(
      http.get('/api/people', () => HttpResponse.json(people)),
      http.post('/api/people', async ({ request }) => {
        const body = (await request.json()) as { name: string };
        people.push({ id: 2, name: body.name, notes: null });
        return HttpResponse.json({ id: 2, name: body.name }, { status: 201 });
      }),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(
      () => ({ people: usePeople(), create: useCreatePerson() }),
      { wrapper: wrapperFor(qc) },
    );

    await waitFor(() => expect(result.current.people.isSuccess).toBe(true));
    expect(result.current.people.data).toHaveLength(1);

    await act(async () => {
      await result.current.create.mutateAsync({ name: 'Babbage' });
    });

    await waitFor(() =>
      expect(result.current.people.data).toEqual([
        { id: 1, name: 'Ada', notes: null },
        { id: 2, name: 'Babbage', notes: null },
      ]),
    );
  });
});

describe('useLinkPerson', () => {
  it('useLinkPerson posts LinkPersonBody', async () => {
    let capturedBody: unknown;
    server.use(
      http.post('/api/items/2/people', async ({ request }) => {
        capturedBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const qc = makeQueryClient();
    const { result } = renderHook(() => useLinkPerson(2), { wrapper: wrapperFor(qc) });

    await act(async () => {
      await result.current.mutateAsync({ personId: 5, role: 'author' });
    });

    expect(capturedBody).toEqual({ personId: 5, role: 'author' });
  });
});
