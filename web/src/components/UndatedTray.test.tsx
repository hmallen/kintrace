import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { ItemSummary } from '@shared/api.js';
import { UndatedTray } from './UndatedTray';

const undated: ItemSummary[] = [
  {
    id: 7,
    title: 'Mystery photo',
    media_type: 'photo',
    date_start: null,
    date_end: null,
    date_precision: 'unknown',
    status: 'pending',
    content_hash: 'hash7',
    thumb_path: null,
  },
  {
    id: 9,
    title: 'Unlabeled letter',
    media_type: 'letter',
    date_start: null,
    date_end: null,
    date_precision: 'unknown',
    status: 'reviewed',
    content_hash: 'hash9',
    thumb_path: null,
  },
];

function renderTray(items: ItemSummary[]) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <UndatedTray items={items} /> },
      { path: '/items/:id', element: <p>Workspace stub</p> },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('UndatedTray', () => {
  it('renders undated entries', () => {
    renderTray(undated);

    const entries = screen.getAllByRole('link');
    expect(entries).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Mystery photo/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Unlabeled letter/ })).toBeInTheDocument();
  });

  it('click navigates to workspace', async () => {
    const router = renderTray(undated);

    await userEvent.click(screen.getByRole('link', { name: /Mystery photo/ }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/items/7');
    });
  });

  it('empty tray', () => {
    renderTray([]);

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByText(/undated/i)).not.toBeInTheDocument();
  });
});
