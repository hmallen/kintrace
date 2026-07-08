import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { ItemSummary } from '@shared/api.js';
import { makeQueryClient } from '../queryClient';
import { routes } from '../router';
import { server } from '../test/msw';
import { itemsHandler } from '../test/handlers';

const items: ItemSummary[] = [
  {
    id: 1,
    title: 'Letter from Grandpa',
    media_type: 'letter',
    date_start: '1943-05-12',
    date_end: '1943-05-12',
    date_precision: 'exact',
    status: 'pending',
    content_hash: 'hash1',
    thumb_path: 'thumbs/hash1.jpg',
  },
  {
    id: 2,
    title: 'Wedding photo',
    media_type: 'photo',
    date_start: '1940-01-01',
    date_end: '1949-12-31',
    date_precision: 'decade',
    status: 'transcribed',
    content_hash: 'hash2',
    thumb_path: 'thumbs/hash2.jpg',
  },
  {
    id: 3,
    title: null,
    media_type: 'article',
    date_start: null,
    date_end: null,
    date_precision: 'unknown',
    status: 'reviewed',
    content_hash: 'hash3',
    thumb_path: null,
  },
];

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('Library', () => {
  it('renders a card per item', async () => {
    server.use(itemsHandler(items));
    renderAt('/');

    expect(await screen.findByText('Letter from Grandpa')).toBeInTheDocument();
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(3);

    const [first, second, third] = cards;
    expect(within(first!).getByText('Letter from Grandpa')).toBeInTheDocument();
    expect(within(first!).getByText('pending')).toBeInTheDocument();
    expect(within(first!).getByText('May 12, 1943')).toBeInTheDocument();
    expect(within(second!).getByText('Wedding photo')).toBeInTheDocument();
    expect(within(second!).getByText('transcribed')).toBeInTheDocument();
    expect(within(second!).getByText('c. 1940s')).toBeInTheDocument();
    expect(within(third!).getByText('Untitled')).toBeInTheDocument();
    expect(within(third!).getByText('reviewed')).toBeInTheDocument();
    expect(within(third!).getByText('Undated')).toBeInTheDocument();
  });

  it('status filter drives the query', async () => {
    const requested: string[] = [];
    server.use(
      http.get('/api/items', ({ request }) => {
        requested.push(request.url);
        const status = new URL(request.url).searchParams.get('status');
        return HttpResponse.json(
          status ? items.filter((item) => item.status === status) : items,
        );
      }),
    );
    renderAt('/?status=pending');

    expect(await screen.findByText('Letter from Grandpa')).toBeInTheDocument();
    expect(
      requested.some((url) => new URL(url).searchParams.get('status') === 'pending'),
    ).toBe(true);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('Wedding photo')).not.toBeInTheDocument();
  });

  it('person filter shows indicator + clear', async () => {
    server.use(itemsHandler(items));
    const router = renderAt('/?personId=5');

    expect(await screen.findByText(/filtered by person/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /clear/i }));

    await waitFor(() => {
      expect(router.state.location.pathname + router.state.location.search).toBe('/');
    });
    expect(screen.queryByText(/filtered by person/i)).not.toBeInTheDocument();
  });

  it('card click navigates to workspace', async () => {
    server.use(
      itemsHandler(items),
      // Stub the target item so the Workspace renders on arrival (top-level
      // query errors now surface in the route boundary, not inline).
      http.get('/api/items/1', () =>
        HttpResponse.json({
          ...items[0],
          file_path: 'archive/ha/hash1.jpg',
          created_at: '2026-07-01T00:00:00Z',
          description: null,
          transcription_diplomatic: null,
          transcription_normalized: null,
          ai_error: null,
          ai_names: null,
          ai_confidence: null,
          people: [],
        }),
      ),
    );
    const router = renderAt('/');

    await userEvent.click(
      await screen.findByRole('link', { name: /Letter from Grandpa/ }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/items/1');
    });
    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });

  it('thumbnail falls back to icon on error', async () => {
    server.use(itemsHandler(items));
    renderAt('/');

    const img = await screen.findByAltText('Letter from Grandpa');
    fireEvent.error(img);

    expect(screen.queryByAltText('Letter from Grandpa')).not.toBeInTheDocument();
    const fallback = screen.getByTestId('thumbnail-fallback');
    expect(within(fallback).getByLabelText('letter icon')).toBeInTheDocument();
  });
});
