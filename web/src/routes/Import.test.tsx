import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ImportResult } from '@shared/api.js';
import { Import, ImportResults } from './Import';

// jsdom can't drive Uppy's real XHR upload, so specs 4-5 feed a known
// ImportResult[] straight into the results-rendering component; the real
// upload path is exercised in a later in-browser check.
const results: ImportResult[] = [
  { path: 'fresh.jpg', itemId: 7, duplicate: false },
  { path: 'dupe.jpg', itemId: 3, duplicate: true },
  { path: 'broken.jpg', error: 'unsupported file type' },
];

describe('Import', () => {
  it('renders per-file outcomes', () => {
    render(
      <MemoryRouter>
        <ImportResults results={results} />
      </MemoryRouter>,
    );

    const importedLink = screen.getByRole('link', { name: /fresh\.jpg/ });
    expect(importedLink).toHaveAttribute('href', '/items/7');

    const duplicateBadge = screen.getByRole('link', { name: /already in archive/ });
    expect(duplicateBadge).toHaveAttribute('href', '/items/3');

    expect(screen.getByText(/unsupported file type/)).toBeInTheDocument();
  });

  it('renders summary line', () => {
    render(
      <MemoryRouter>
        <ImportResults results={results} />
      </MemoryRouter>,
    );

    expect(screen.getByText('1 imported, 1 already in archive, 1 failed')).toBeInTheDocument();
  });

  it('media-type selector present', () => {
    render(
      <MemoryRouter>
        <Import />
      </MemoryRouter>,
    );

    const selector = screen.getByRole('combobox', { name: /media type/i });
    const options = within(selector).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'photo',
      'letter',
      'article',
      'audio',
      'video',
      'pdf',
    ]);
  });
});
