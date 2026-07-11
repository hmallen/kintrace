import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { EventSummary, ItemSummary, Person, TimelineStoryState } from '@shared/api.js';
import { makeQueryClient } from '../queryClient';
import { routes } from '../router';
import { server } from '../test/msw';
import { eventsHandler, itemsHandler, peopleHandler } from '../test/handlers';

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

const events: EventSummary[] = [
  {
    id: 5,
    title: 'Birth of John Smith',
    description: null,
    date_start: '1943-01-01',
    date_end: '1943-12-31',
    date_precision: 'year',
    person_id: 1,
    source_type: 'gedcom',
    gedcom_import_id: 1,
    gedcom_xref: '@I1@',
    gedcom_tag: 'BIRT',
    gedcom_date_raw: '1943',
    source_text: null,
  },
];

const people: Person[] = [{ id: 3, name: 'Ada Voss', notes: null }];

const adaItem: ItemSummary = {
  id: 20,
  title: 'Ada portrait',
  media_type: 'photo',
  date_start: '1943-06-01',
  date_end: '1943-06-01',
  date_precision: 'exact',
  status: 'reviewed',
  content_hash: 'hash20',
  thumb_path: null,
};

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('Timeline route', () => {
  it('renders the Explore view with cards, milestones, and the undated tray by default', async () => {
    server.use(itemsHandler(items), eventsHandler(events));
    renderAt('/timeline');

    expect(await screen.findByTestId('explore-scroller')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Letter from Grandpa/ })).toBeInTheDocument();
    expect(screen.getByText('Birth of John Smith')).toBeInTheDocument();
    const tray = screen.getByRole('complementary', { name: /undated/i });
    expect(within(tray).getByRole('link', { name: /Mystery photo/ })).toBeInTheDocument();
  });

  it('navigates to the item workspace when a card is opened', async () => {
    const user = userEvent.setup();
    server.use(itemsHandler(items), eventsHandler([]));
    const router = renderAt('/timeline');

    await user.click(await screen.findByRole('button', { name: /Letter from Grandpa/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/items/1'));
  });

  it('toggles the scale, re-laying-out the axis and updating the URL', async () => {
    const user = userEvent.setup();
    server.use(itemsHandler([items[0]!]), eventsHandler(events));
    const router = renderAt('/timeline');

    await screen.findByTestId('explore-scroller');
    const canvas = document.querySelector<HTMLElement>('.explore-canvas')!;
    const chronologicalWidth = canvas.style.width;

    const sequential = screen.getByRole('button', { name: /sequential/i });
    expect(sequential).toHaveAttribute('aria-pressed', 'false');
    await user.click(sequential);

    expect(screen.getByRole('button', { name: /sequential/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(router.state.location.search).toContain('scale=sequential');
    expect(document.querySelector<HTMLElement>('.explore-canvas')!.style.width).not.toBe(
      chronologicalWidth,
    );
  });

  it('toggles orientation between horizontal and vertical', async () => {
    const user = userEvent.setup();
    server.use(itemsHandler([items[0]!]), eventsHandler([]));
    const router = renderAt('/timeline');

    await screen.findByTestId('explore-scroller');
    await user.click(screen.getByRole('button', { name: /vertical/i }));

    expect(screen.getByTestId('explore-scroller').className).toContain('explore-vertical');
    expect(router.state.location.search).toContain('orientation=vertical');
  });

  it('filters items by person through the API', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/items', ({ request }) => {
        const personId = new URL(request.url).searchParams.get('personId');
        return HttpResponse.json(personId === '3' ? [adaItem] : items);
      }),
      eventsHandler([]),
      peopleHandler(people),
    );
    const router = renderAt('/timeline');

    await screen.findByRole('button', { name: /Letter from Grandpa/ });
    await user.selectOptions(screen.getByLabelText(/person/i), '3');

    expect(await screen.findByRole('button', { name: /Ada portrait/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Letter from Grandpa/ })).not.toBeInTheDocument();
    expect(router.state.location.search).toContain('personId=3');
  });

  it('offers a data-table fallback including undated items', async () => {
    const user = userEvent.setup();
    server.use(itemsHandler(items), eventsHandler(events));
    renderAt('/timeline');

    await screen.findByTestId('explore-scroller');
    await user.click(screen.getByRole('button', { name: /table/i }));

    const table = screen.getByRole('table', { name: /timeline/i });
    expect(within(table).getByRole('link', { name: /Letter from Grandpa/ })).toBeInTheDocument();
    expect(within(table).getByText('Birth of John Smith')).toBeInTheDocument();
    const undatedRow = within(table).getByRole('link', { name: /Mystery photo/ }).closest('tr')!;
    expect(within(undatedRow).getByText('Undated')).toBeInTheDocument();
    expect(screen.queryByTestId('explore-scroller')).not.toBeInTheDocument();
  });

  it('tells a scroll-driven story with decade chapters in Story view', async () => {
    server.use(itemsHandler([items[0]!]), eventsHandler([]));
    renderAt('/timeline?view=story');

    expect(await screen.findByText('The 1940s')).toBeInTheDocument();
    expect(screen.getByText('Letter from Grandpa')).toBeInTheDocument();
    expect(screen.queryByTestId('explore-scroller')).not.toBeInTheDocument();
  });

  it('generates only on a manual press and shows source-linked whole-library prose', async () => {
    const user = userEvent.setup();
    let postCalls = 0;
    const emptyState: TimelineStoryState = {
      story: null,
      sources: [],
      generatedAt: null,
      model: null,
      storySourceCount: 0,
      eligibleSourceCount: 1,
      stale: false,
      canGenerate: true,
      unavailableReason: null,
    };
    const savedState: TimelineStoryState = {
      ...emptyState,
      story: {
        title: 'The Voss archive',
        sections: [{
          heading: 'A documented beginning',
          paragraphs: [{ text: 'Ada appears in a reviewed portrait.', sourceItemIds: [2] }],
        }],
      },
      sources: [{
        itemId: 2,
        title: 'Mystery photo',
        dateStart: null,
        dateEnd: null,
        datePrecision: 'unknown',
        available: true,
      }],
      generatedAt: '2026-07-11 12:00:00',
      model: 'test-model',
      storySourceCount: 1,
    };
    server.use(
      http.get('/api/items', ({ request }) => {
        const personId = new URL(request.url).searchParams.get('personId');
        return HttpResponse.json(personId === '3' ? [adaItem] : items);
      }),
      eventsHandler([]),
      peopleHandler(people),
      http.get('/api/timeline/story', () => HttpResponse.json(emptyState)),
      http.post('/api/timeline/story', () => {
        postCalls += 1;
        return HttpResponse.json(savedState);
      }),
    );
    renderAt('/timeline?view=story&personId=3');

    const generate = await screen.findByRole('button', { name: 'Generate story' });
    expect(postCalls).toBe(0);
    await user.click(generate);

    expect(await screen.findByRole('heading', { name: 'The Voss archive' })).toBeInTheDocument();
    expect(postCalls).toBe(1);
    expect(screen.getByText('Ada appears in a reviewed portrait.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mystery photo · Undated/ })).toHaveAttribute(
      'href',
      '/items/2',
    );
    expect(screen.getByText(/regardless of the person filter/i)).toBeInTheDocument();
  });

  it('keeps a stale saved story visible with an out-of-date warning', async () => {
    const staleState: TimelineStoryState = {
      story: {
        title: 'Saved archive story',
        sections: [{
          heading: 'Saved section',
          paragraphs: [{ text: 'Previously generated text.', sourceItemIds: [2] }],
        }],
      },
      sources: [{
        itemId: 2,
        title: 'Mystery photo',
        dateStart: null,
        dateEnd: null,
        datePrecision: 'unknown',
        available: true,
      }],
      generatedAt: '2026-07-11 12:00:00',
      model: 'test-model',
      storySourceCount: 1,
      eligibleSourceCount: 2,
      stale: true,
      canGenerate: true,
      unavailableReason: null,
    };
    server.use(
      itemsHandler([items[0]!]),
      eventsHandler([]),
      http.get('/api/timeline/story', () => HttpResponse.json(staleState)),
    );
    renderAt('/timeline?view=story');

    expect(await screen.findByText('Previously generated text.')).toBeInTheDocument();
    expect(screen.getByText('Out of date.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate story' })).toBeEnabled();
  });

  it('scopes Story mode to the selected person, events included', async () => {
    server.use(
      http.get('/api/items', ({ request }) => {
        const personId = new URL(request.url).searchParams.get('personId');
        return HttpResponse.json(personId === '3' ? [adaItem] : items);
      }),
      eventsHandler([{ ...events[0]!, person_id: 1 }]),
      peopleHandler(people),
    );
    renderAt('/timeline?view=story&personId=3');

    expect(await screen.findByText('Ada portrait')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Ada Voss/ })).toBeInTheDocument();
    // The event belongs to person 1, not the filtered person 3.
    expect(screen.queryByText('Birth of John Smith')).not.toBeInTheDocument();
  });

  it('forces a vertical stacked layout on narrow viewports', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;
    try {
      server.use(itemsHandler([items[0]!]), eventsHandler([]));
      renderAt('/timeline');

      expect((await screen.findByTestId('explore-scroller')).className).toContain(
        'explore-vertical',
      );
      expect(screen.queryByRole('button', { name: /horizontal/i })).not.toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('shows an empty state instead of a bare axis', async () => {
    server.use(itemsHandler([]), eventsHandler([]));
    renderAt('/timeline');

    expect(await screen.findByText(/nothing on the timeline yet/i)).toBeInTheDocument();
  });
});
