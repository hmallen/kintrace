import { render, screen } from '@testing-library/react';
import type { EventSummary, ItemSummary } from '@shared/api.js';
import { toEntries } from '../timeline/layout';
import { StoryView } from './StoryView';

const items: ItemSummary[] = [
  {
    id: 1,
    title: 'Armistice celebration photo',
    media_type: 'photo',
    date_start: '1918-11-11',
    date_end: '1918-11-11',
    date_precision: 'exact',
    status: 'reviewed',
    content_hash: 'hash1',
    thumb_path: null,
  },
  {
    id: 2,
    title: 'Wedding announcement',
    media_type: 'article',
    date_start: '1922-01-01',
    date_end: '1922-12-31',
    date_precision: 'year',
    status: 'transcribed',
    content_hash: 'hash2',
    thumb_path: null,
  },
];

const events: EventSummary[] = [
  {
    id: 5,
    title: 'Birth of Ada Voss',
    description: null,
    date_start: '1920-03-01',
    date_end: '1920-03-31',
    date_precision: 'month',
    person_id: 3,
    source_type: 'gedcom',
    gedcom_import_id: 1,
    gedcom_xref: '@I1@',
    gedcom_tag: 'BIRT',
    gedcom_date_raw: 'MAR 1920',
    source_text: null,
  },
];

describe('StoryView', () => {
  it('renders chapters per decade with the entries as story cards', () => {
    const { entries } = toEntries(items, events);
    render(<StoryView entries={entries} heading="The whole archive" />);

    expect(screen.getByRole('heading', { name: 'The whole archive' })).toBeInTheDocument();
    // Decade chapters, in order, once each.
    expect(screen.getAllByText('The 1910s')).toHaveLength(1);
    expect(screen.getAllByText('The 1920s')).toHaveLength(1);
    // Every dated entry becomes a card, items and life events alike.
    expect(screen.getByText('Armistice celebration photo')).toBeInTheDocument();
    expect(screen.getByText('Birth of Ada Voss')).toBeInTheDocument();
    expect(screen.getByText('Wedding announcement')).toBeInTheDocument();
  });

  it('keeps the fuzzy date labels on the cards', () => {
    const { entries } = toEntries(items, []);
    render(<StoryView entries={entries} heading="Archive" />);

    expect(screen.getByText('November 11, 1918')).toBeInTheDocument();
    expect(screen.getByText('1922')).toBeInTheDocument();
  });

  it('shows an empty state instead of an empty timeline', () => {
    render(<StoryView entries={[]} heading="Ada Voss" />);

    expect(screen.getByText(/no dated items/i)).toBeInTheDocument();
    expect(screen.queryByText('The 1910s')).not.toBeInTheDocument();
  });
});
