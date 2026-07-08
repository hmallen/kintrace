import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { ItemSummary } from '@shared/api.js';
import { makeQueryClient } from '../queryClient';
import { routes } from '../router';
import { RouteErrorBoundary } from './RouteErrorBoundary';
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

describe('RouteErrorBoundary', () => {
  it('query ApiError renders boundary with retry', async () => {
    // The Library's items query fails with a non-2xx ApiError.
    server.use(
      http.get('/api/items', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    renderAt('/');

    // Error UI surfaces inside the route boundary (not the item list), with retry.
    const retry = await screen.findByRole('button', { name: /retry/i });
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.queryByText('Letter from Grandpa')).not.toBeInTheDocument();

    // Retry actually refetches: the backend now returns 200 → the list renders.
    server.use(itemsHandler(items));
    await userEvent.click(retry);

    expect(await screen.findByText('Letter from Grandpa')).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it('zod parse failure renders boundary', async () => {
    // A 2xx body that does not match the schema → apiFetch throws a ZodError.
    server.use(
      http.get('/api/items', () =>
        HttpResponse.json({ not: 'an array' }),
      ),
    );
    renderAt('/');

    // The boundary catches it rather than letting a silently-wrong render through.
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    // Not a backend-down state — this is a route-level error.
    expect(
      screen.queryByText(/can't reach the kintrace backend/i),
    ).not.toBeInTheDocument();
  });

  it('fetch rejection renders BackendDown', async () => {
    // A network-level failure (backend not reachable) → fetch rejects (TypeError).
    server.use(http.get('/api/items', () => HttpResponse.error()));
    renderAt('/');

    expect(
      await screen.findByText(/can't reach the kintrace backend on :3271/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('render-time exception renders the generic route-level error, not BackendDown', () => {
    // A component bug that throws during render (NOT a fetch/network failure)
    // must land on the generic "Something went wrong" UI — BackendDown is
    // reserved for genuine fetch rejections, so mislabeling this as ":3271
    // unreachable" would hide the real bug.
    function Boom(): never {
      throw new Error('render blew up');
    }
    // React logs the caught error to console.error; silence it for this spec.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <RouteErrorBoundary>
          <Boom />
        </RouteErrorBoundary>
      </QueryClientProvider>,
    );
    spy.mockRestore();

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText('render blew up')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(
      screen.queryByText(/can't reach the kintrace backend/i),
    ).not.toBeInTheDocument();
  });
});
