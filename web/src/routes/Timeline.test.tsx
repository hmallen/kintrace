import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
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
    thumb_path: null,
  },
  {
    id: 2,
    title: 'Mystery photo',
    media_type: 'photo',
    date_start: null,
    date_end: null,
    date_precision: 'unknown',
    status: 'reviewed',
    content_hash: 'hash2',
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

describe('Timeline', () => {
  it('renders without crashing and shows undated count', async () => {
    server.use(itemsHandler(items));
    renderAt('/timeline');

    expect(await screen.findByText(/1 undated/)).toBeInTheDocument();
    expect(screen.getByTestId('timeline-view')).toBeInTheDocument();
  });
});
