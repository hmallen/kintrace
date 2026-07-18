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
  { path: 'fresh.jpg', itemId: 7, duplicate: false, mediaType: 'pdf', status: 'pending', autoSelected: false },
  { path: 'dupe.jpg', itemId: 3, duplicate: true, mediaType: 'photo', status: 'reviewed', autoSelected: false },
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
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <ImportResults results={results} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const importedLink = screen.getByRole('link', { name: /fresh\.jpg/ });
    expect(importedLink).toHaveAttribute('href', '/items/7');

    const duplicateBadge = screen.getByRole('link', { name: /dupe\.jpg/ });
    expect(duplicateBadge).toHaveAttribute('href', '/items/3');
    expect(screen.getAllByText(/already in archive/)).toHaveLength(2);

    expect(screen.getByText(/unsupported file type/)).toBeInTheDocument();
  });

  it('renders summary line', () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <ImportResults results={results} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText('1 imported, 1 already in archive, 1 failed')).toBeInTheDocument();
  });

  it('media-type selector present', () => {
    renderImport();

    const selector = screen.getByRole('combobox', { name: /type to use for image files/i });
    const options = within(selector).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Photograph',
      'Letter or correspondence',
      'Newspaper or magazine article',
      'Audio recording',
      'Video recording',
      'General document (certificate, diploma, form, or record)',
    ]);
  });

  it('explains the processing implications of every media type and tracks the selection', async () => {
    const user = userEvent.setup();
    renderImport();

    const panel = screen.getByRole('complementary', { name: /what this selection changes/i });
    expect(within(panel).getByText(/only transcribes visible captions or inscriptions/i)).toBeInTheDocument();
    expect(within(panel).getByText(/preserves original spelling, punctuation, and line breaks/i)).toBeInTheDocument();
    expect(within(panel).getByText(/headline and full article text/i)).toBeInTheDocument();
    expect(within(panel).getAllByText(/does not extract its speech/i)).toHaveLength(2);
    expect(within(panel).getByText(/certificates, diplomas, forms, official records/i)).toBeInTheDocument();

    expect(within(panel).getByText('General document').closest('div')).toHaveClass('is-selected');
    await user.selectOptions(screen.getByRole('combobox', { name: /type to use for image files/i }), 'letter');
    expect(within(panel).getByText('Letter').closest('div')).toHaveClass('is-selected');
    expect(within(panel).getByText('General document').closest('div')).not.toHaveClass('is-selected');
  });

  it('can switch to GEDCOM family tree import mode', async () => {
    const user = userEvent.setup();
    renderImport();

    await user.click(screen.getByRole('radio', { name: /GEDCOM family tree/i }));

    expect(screen.getByLabelText(/GEDCOM file/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Queue GEDCOM for review/i })).toBeDisabled();
    expect(screen.queryByRole('combobox', { name: /type to use|type for every/i })).not.toBeInTheDocument();
  });

  it('offers a large-photo document splitting workflow', async () => {
    const user = userEvent.setup();
    renderImport();

    await user.click(screen.getByRole('radio', { name: /photograph of many documents/i }));

    expect(screen.getByRole('heading', { name: /split one overhead photograph/i })).toBeInTheDocument();
    expect(screen.getByText(/plain surface that contrasts with their edges/i)).toBeInTheDocument();
    const input = screen.getByLabelText(/large document photograph/i);
    const submit = screen.getByRole('button', { name: /split and import documents/i });
    expect(submit).toBeDisabled();

    await user.upload(input, new File(['image'], 'desk.jpg', { type: 'image/jpeg' }));
    expect(submit).toBeEnabled();
    expect(screen.queryByRole('combobox', { name: /type to use|type for every/i })).not.toBeInTheDocument();
  });
});
