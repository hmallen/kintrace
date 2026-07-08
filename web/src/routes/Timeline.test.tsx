import { act, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { ItemSummary } from '@shared/api.js';
import { makeQueryClient } from '../queryClient';
import { routes } from '../router';
import { server } from '../test/msw';
import { itemsHandler } from '../test/handlers';

// jsdom can't lay out (or click) vis-timeline's canvas-like DOM, so the real
// Timeline is replaced with a fake that captures the handlers TimelineView
// registers via `on(...)`. Spec "click axis item navigates" then fires the
// wired 'select' handler directly — the component's public seam — instead of
// simulating a real vis select event.
const { selectHandlers } = vi.hoisted(() => ({
  selectHandlers: [] as Array<(props?: { items?: Array<string | number> }) => void>,
}));

vi.mock('vis-timeline/standalone', () => {
  class FakeTimeline {
    on(event: string, callback: (props?: { items?: Array<string | number> }) => void) {
      if (event === 'select') selectHandlers.push(callback);
    }
    setItems() {}
    fit() {}
    destroy() {}
  }
  return { Timeline: FakeTimeline };
});

beforeEach(() => {
  selectHandlers.length = 0;
});

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

  it('unknown items appear in tray not axis', async () => {
    server.use(
      itemsHandler([
        {
          id: 10,
          title: 'Annual report',
          media_type: 'article',
          date_start: '1943-01-01',
          date_end: '1943-12-31',
          date_precision: 'year',
          status: 'transcribed',
          content_hash: 'hash10',
          thumb_path: null,
        },
        {
          id: 11,
          title: 'Mystery photo',
          media_type: 'photo',
          date_start: null,
          date_end: null,
          date_precision: 'unknown',
          status: 'pending',
          content_hash: 'hash11',
          thumb_path: null,
        },
      ]),
    );
    renderAt('/timeline');

    // The unknown item lives in the tray…
    const tray = await screen.findByRole('complementary', { name: /undated/i });
    expect(within(tray).getByRole('link', { name: /Mystery photo/ })).toBeInTheDocument();
    // …the dated item does not…
    expect(within(tray).queryByText(/Annual report/)).not.toBeInTheDocument();
    // …and the axis received exactly the one dated datum (test hook exposing
    // toTimelineData().data.length — jsdom can't lay out vis-timeline's DOM).
    expect(screen.getByTestId('timeline-view')).toHaveAttribute('data-item-count', '1');
  });

  it('click axis item navigates', async () => {
    server.use(itemsHandler(items));
    const router = renderAt('/timeline');

    await screen.findByTestId('timeline-view');
    expect(selectHandlers.length).toBeGreaterThan(0);

    // Fire the select handler TimelineView wired onto vis-timeline, as vis
    // would on an item click (item 1 is the dated axis item).
    act(() => {
      for (const handler of selectHandlers) handler({ items: [1] });
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/items/1'));
  });
});
