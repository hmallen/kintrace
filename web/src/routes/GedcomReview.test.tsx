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
    await user.click(screen.getByText('John Smith', { selector: 'summary' }));
    expect(screen.getByText('1901-01-01')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(screen.getByText(/accepted/)).toBeInTheDocument());
  });

  it('filters by individual and selects all of their related records', async () => {
    const jane: GedcomReviewItem = {
      ...queuedPerson,
      id: 13,
      label: 'Jane Smith',
      gedcomXref: '@I2@',
      payload: { name: 'Jane Smith' },
    };
    const relationship: GedcomReviewItem = {
      ...queuedPerson,
      id: 20,
      group: 'relationships',
      label: 'John Smith — spouse — Jane Smith',
      gedcomXref: null,
      payload: { personXref: '@I1@', relatedPersonXref: '@I2@', relationship: 'spouse' },
    };
    const johnEvent: GedcomReviewItem = {
      ...queuedPerson,
      id: 21,
      group: 'events',
      label: 'Birth of John Smith',
      gedcomXref: null,
      payload: { personXref: '@I1@', dateStart: '1901-01-01' },
    };
    const janeEvent: GedcomReviewItem = {
      ...queuedPerson,
      id: 22,
      group: 'events',
      label: 'Birth of Jane Smith',
      gedcomXref: null,
      payload: { personXref: '@I2@', dateStart: '1903-01-01' },
    };
    const allItems = [queuedPerson, jane, relationship, johnEvent, janeEvent];
    let accepted = new Set<number>();
    const selections: unknown[] = [];
    server.use(
      http.get('/api/gedcom/review', () => HttpResponse.json({
        groups: [
          { group: 'people', items: allItems.filter((item) => item.group === 'people').map((item) => ({
            ...item, status: accepted.has(item.id) ? 'accepted' : 'pending',
          })) },
          { group: 'relationships', items: allItems.filter((item) => item.group === 'relationships').map((item) => ({
            ...item, status: accepted.has(item.id) ? 'accepted' : 'pending',
          })) },
          { group: 'events', items: allItems.filter((item) => item.group === 'events').map((item) => ({
            ...item, status: accepted.has(item.id) ? 'accepted' : 'pending',
          })) },
        ],
      })),
      http.post('/api/gedcom/review/selection/accept', async ({ request }) => {
        const body = (await request.json()) as { ids: number[] };
        selections.push(body);
        accepted = new Set(body.ids);
        return HttpResponse.json(allItems.filter((item) => accepted.has(item.id)).map((item) => ({
          ...item, status: 'accepted',
        })));
      }),
    );

    const user = userEvent.setup();
    renderReview();
    await user.selectOptions(await screen.findByLabelText('Individual'), '3:@I1@');

    expect(screen.getByRole('checkbox', { name: 'Select John Smith' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select John Smith — spouse — Jane Smith' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Birth of John Smith' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Select Birth of Jane Smith' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Select all records for John Smith' }));
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept selected' }));

    await waitFor(() => expect(selections).toEqual([{ ids: [12, 20, 21] }]));
    await waitFor(() => expect(screen.getByText('0 selected')).toBeInTheDocument());
  });
});
