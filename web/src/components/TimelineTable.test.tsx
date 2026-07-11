import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ItemSummary } from '@shared/api.js';
import { toEntries } from '../timeline/layout';
import { TimelineTable } from './TimelineTable';

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

function renderTable() {
  const { entries, undated } = toEntries(items, [
    {
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
    },
  ]);
  render(
    <MemoryRouter>
      <TimelineTable entries={entries} undated={undated} />
    </MemoryRouter>,
  );
}

describe('TimelineTable', () => {
  it('is a captioned table with scoped column headers', () => {
    renderTable();

    const table = screen.getByRole('table', { name: /timeline/i });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Date', 'Title', 'Kind', 'Status']);
    for (const header of headers) expect(header).toHaveAttribute('scope', 'col');
  });

  it('lists dated entries in date order with item links and event rows', () => {
    renderTable();

    const table = screen.getByRole('table', { name: /timeline/i });
    const rows = within(table).getAllByRole('row').slice(1); // skip header
    expect(within(rows[0]!).getByText('Birth of John Smith')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Life event')).toBeInTheDocument();
    expect(within(rows[0]!).queryByRole('link')).not.toBeInTheDocument();
    const itemLink = within(rows[1]!).getByRole('link', { name: /Letter from Grandpa/ });
    expect(itemLink).toHaveAttribute('href', '/items/1');
    expect(within(rows[1]!).getByText('May 12, 1943')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('pending')).toBeInTheDocument();
  });

  it('appends undated items with an explicit Undated marker', () => {
    renderTable();

    const table = screen.getByRole('table', { name: /timeline/i });
    const undatedRow = within(table).getByRole('link', { name: /Mystery photo/ }).closest('tr')!;
    expect(within(undatedRow).getByText('Undated')).toBeInTheDocument();
  });
});
