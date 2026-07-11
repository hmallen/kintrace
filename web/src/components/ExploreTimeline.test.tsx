import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EventSummary, ItemSummary } from '@shared/api.js';
import { clusterLayout, layoutTimeline, toEntries, type Scale } from '../timeline/layout';
import type { Orientation } from '../timeline/useVirtualWindow';
import { ExploreTimeline } from './ExploreTimeline';

function makeItem(overrides: Partial<ItemSummary>): ItemSummary {
  return {
    id: 1,
    title: 'Letter from Grandpa',
    media_type: 'letter',
    date_start: '1943-05-12',
    date_end: '1943-05-12',
    date_precision: 'exact',
    status: 'reviewed',
    content_hash: 'hash1',
    thumb_path: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EventSummary>): EventSummary {
  return {
    id: 5,
    title: 'Birth of John Smith',
    description: null,
    date_start: '1901-01-01',
    date_end: '1901-12-31',
    date_precision: 'year',
    person_id: 1,
    source_type: 'gedcom',
    gedcom_import_id: 1,
    gedcom_xref: '@I1@',
    gedcom_tag: 'BIRT',
    gedcom_date_raw: '1901',
    source_text: null,
    ...overrides,
  };
}

function renderExplore({
  items = [] as ItemSummary[],
  events = [] as EventSummary[],
  scale = 'chronological' as Scale,
  orientation = 'horizontal' as Orientation,
  onOpenItem = vi.fn(),
  layoutOpts = { pxPerDay: 1 } as Parameters<typeof layoutTimeline>[2],
  clusterOpts = undefined as Parameters<typeof clusterLayout>[1],
}) {
  const { entries } = toEntries(items, events);
  const layout = layoutTimeline(entries, scale, layoutOpts);
  const nodes = clusterLayout(layout, clusterOpts);
  const view = render(
    <ExploreTimeline
      nodes={nodes}
      layout={layout}
      scale={scale}
      orientation={orientation}
      onOpenItem={onOpenItem}
    />,
  );
  return { ...view, onOpenItem };
}

describe('ExploreTimeline', () => {
  it('renders an item card with lazy thumbnail, title, date label, and status', () => {
    renderExplore({
      items: [makeItem({ id: 3, title: 'Armistice photo', status: 'pending', media_type: 'photo' })],
    });

    const card = screen.getByRole('button', { name: /Armistice photo/ });
    expect(within(card).getByText('May 12, 1943')).toBeInTheDocument();
    expect(within(card).getByText('pending')).toBeInTheDocument();
    const img = within(card).getByRole('img', { name: /Armistice photo/ });
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('src', '/api/items/3/thumbnail');
    // Media type is stated, not just implied by the thumbnail (non-color cue).
    expect(within(card).getByRole('img', { name: 'photo icon' })).toBeInTheDocument();
  });

  it('opens the item when its card is activated', async () => {
    const user = userEvent.setup();
    const { onOpenItem } = renderExplore({ items: [makeItem({ id: 9 })] });

    await user.click(screen.getByRole('button', { name: /Letter from Grandpa/ }));

    expect(onOpenItem).toHaveBeenCalledWith(9);
  });

  it('windowing: keeps far-away nodes out of the DOM until scrolled into view', () => {
    renderExplore({
      items: [
        makeItem({ id: 1, title: 'Near item', date_start: '1900-01-05', date_end: '1900-01-05' }),
        makeItem({ id: 2, title: 'Far item', date_start: '2050-01-01', date_end: '2050-01-01' }),
      ],
    });

    expect(screen.getByText('Near item')).toBeInTheDocument();
    expect(screen.queryByText('Far item')).not.toBeInTheDocument();

    const scroller = screen.getByTestId('explore-scroller');
    Object.defineProperty(scroller, 'clientWidth', { value: 800, configurable: true });
    scroller.scrollLeft = 54_700; // ~150 years at 1px/day
    fireEvent.scroll(scroller);

    expect(screen.getByText('Far item')).toBeInTheDocument();
    expect(screen.queryByText('Near item')).not.toBeInTheDocument();
  });

  it('renders only a small window of a large archive', () => {
    const items: ItemSummary[] = [];
    for (let i = 0; i < 500; i++) {
      const year = 1850 + (i % 100);
      items.push(
        makeItem({ id: i + 1, title: `Item ${i + 1}`, date_start: `${year}-06-15`, date_end: `${year}-06-15` }),
      );
    }
    renderExplore({ items, clusterOpts: { minSize: 501 } }); // disable clustering

    const rendered = screen.getAllByRole('listitem');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(100);
  });

  it('renders events as non-interactive milestone markers without thumbnails', () => {
    renderExplore({ events: [makeEvent({})] });

    const milestone = screen.getByText('Birth of John Smith').closest('li')!;
    expect(within(milestone).queryByRole('button')).not.toBeInTheDocument();
    expect(within(milestone).queryByRole('img')).not.toBeInTheDocument();
    expect(within(milestone).getByText('1901')).toBeInTheDocument();
  });

  it('marks uncertain entries with their precision and a circa label', () => {
    renderExplore({
      items: [
        makeItem({
          id: 4,
          title: 'Farm photograph',
          date_start: '1940-01-01',
          date_end: '1949-12-31',
          date_precision: 'decade',
        }),
      ],
    });

    const li = screen.getByText('Farm photograph').closest('li')!;
    expect(li.className).toContain('precision-decade');
    expect(within(li).getByText('c. 1940s')).toBeInTheDocument();
    expect(li.querySelector('.explore-span')).not.toBeNull();
  });

  it('collapses crowded runs into an expandable cluster', async () => {
    const user = userEvent.setup();
    const dates = ['1923-01-01', '1923-01-02', '1923-01-03', '1923-01-04'];
    renderExplore({
      items: dates.map((date_start, i) =>
        makeItem({ id: i + 1, title: `Crowded ${i + 1}`, date_start, date_end: date_start }),
      ),
    });

    expect(screen.queryByText('Crowded 1')).not.toBeInTheDocument();
    const clusterButton = screen.getByRole('button', { name: /4 items/ });
    expect(clusterButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(clusterButton);

    expect(screen.getByText('Crowded 1')).toBeInTheDocument();
    expect(screen.getByText('Crowded 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /4 items/ })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: /4 items/ }));

    expect(screen.queryByText('Crowded 1')).not.toBeInTheDocument();
  });

  it('moves focus between cards with arrow keys, Home, and End', async () => {
    const user = userEvent.setup();
    renderExplore({
      items: [
        makeItem({ id: 1, title: 'First', date_start: '1900-01-01', date_end: '1900-01-01' }),
        makeItem({ id: 2, title: 'Second', date_start: '1900-06-01', date_end: '1900-06-01' }),
        makeItem({ id: 3, title: 'Third', date_start: '1901-01-01', date_end: '1901-01-01' }),
      ],
    });

    const first = screen.getByRole('button', { name: /First/ });
    first.focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: /Second/ })).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: /Third/ })).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: /Second/ })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
  });

  it('labels the timeline for assistive tech and hides decorative ticks', () => {
    renderExplore({ items: [makeItem({})] });

    expect(screen.getByRole('list', { name: /timeline/i })).toBeInTheDocument();
    const axis = document.querySelector('.explore-axis');
    expect(axis).not.toBeNull();
    expect(axis!.getAttribute('aria-hidden')).toBe('true');
  });

  it('switches the layout class with orientation', () => {
    renderExplore({ items: [makeItem({})], orientation: 'vertical' });

    expect(screen.getByTestId('explore-scroller').className).toContain('explore-vertical');
  });
});
