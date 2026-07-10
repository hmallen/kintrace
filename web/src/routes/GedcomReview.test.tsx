import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { GedcomReviewItem } from '@shared/api.js';
import { makeQueryClient } from '../queryClient';
import { server } from '../test/msw';
import { GedcomReview } from './GedcomReview';

const queuedPerson: GedcomReviewItem = {
  id: 12,
  importId: 3,
  group: 'people',
  label: 'John Smith',
  gedcomXref: '@I1@',
  payload: { name: 'John Smith', birthStart: '1901-01-01' },
  status: 'pending',
  createdAt: '2026-07-09 12:00:00',
  reviewedAt: null,
};

function renderReview() {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>
        <GedcomReview />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GEDCOM review queue', () => {
  it('groups proposals, shows their details, and accepts an item', async () => {
    let status: GedcomReviewItem['status'] = 'pending';
    server.use(
      http.get('/api/gedcom/review', () => HttpResponse.json({
        groups: [
          { group: 'people', items: [{ ...queuedPerson, status }] },
          { group: 'relationships', items: [] },
          { group: 'events', items: [] },
        ],
      })),
      http.post('/api/gedcom/review/12/accept', () => {
        status = 'accepted';
        return HttpResponse.json({ ...queuedPerson, status });
      }),
    );

    const user = userEvent.setup();
    renderReview();
    expect(await screen.findByRole('heading', { name: /People \(1 pending\)/i })).toBeInTheDocument();
    await user.click(screen.getAllByText('John Smith')[0]!);
    expect(screen.getByText('1901-01-01')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(screen.getByText(/accepted/)).toBeInTheDocument());
  });
});
