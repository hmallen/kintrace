import { render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ImportResult } from '@shared/api.js';
import { makeQueryClient } from '../queryClient';
import { Import, ImportResults } from './Import';

// jsdom can't drive Uppy's real XHR upload, so specs 4-5 feed a known
// ImportResult[] straight into the results-rendering component; the real
// upload path is exercised in a later in-browser check.
const results: ImportResult[] = [
  { path: 'fresh.jpg', itemId: 7, duplicate: false },
  { path: 'dupe.jpg', itemId: 3, duplicate: true },
  { path: 'broken.jpg', error: 'unsupported file type' },
];

function renderImport() {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>
        <Import />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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
    renderImport();

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

  it('can switch to GEDCOM family tree import mode', async () => {
    const user = userEvent.setup();
    renderImport();

    await user.click(screen.getByRole('radio', { name: /GEDCOM family tree/i }));

    expect(screen.getByLabelText(/GEDCOM file/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Queue GEDCOM for review/i })).toBeDisabled();
    expect(screen.queryByRole('combobox', { name: /media type/i })).not.toBeInTheDocument();
  });
});
