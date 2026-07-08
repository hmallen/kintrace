import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type {
  ItemDetail,
  LinkPersonBody,
  PatchItemBody,
  Person,
} from '@shared/api.js';
import { normalizeFuzzyDate } from '@shared/dates.js';
import { makeQueryClient } from '../queryClient';
import { routes } from '../router';
import { server } from '../test/msw';

const baseItem: ItemDetail = {
  id: 1,
  title: 'Letter from Grandpa',
  media_type: 'letter',
  date_start: '1943-05-12',
  date_end: '1943-05-12',
  date_precision: 'exact',
  status: 'transcribed',
  content_hash: 'hash1',
  thumb_path: 'thumbs/hash1.jpg',
  file_path: 'archive/ha/hash1.jpg',
  created_at: '2026-07-01T00:00:00Z',
  description: 'A wartime letter',
  transcription_diplomatic: 'Dear famly [?]\nI am well',
  transcription_normalized: 'Dear family, I am well.',
  ai_error: null,
  ai_names: null,
  ai_confidence: {
    overall: 'medium',
    summary: 'Some words are hard to read',
    flaggedSpans: [{ text: 'famly [?]', reason: 'possible misspelling of family' }],
  },
  people: [],
};

// Stateful in-test backend: GET serves the current item (so post-mutation
// invalidation refetches see server truth), PATCH/POST capture exact bodies.
function setupItemScenario(initial: ItemDetail, people: Person[] = []) {
  let current = initial;
  const patches: PatchItemBody[] = [];
  const links: LinkPersonBody[] = [];
  const created: unknown[] = [];
  const directory = [...people];
  let nextPersonId = 100;

  server.use(
    http.get(`/api/items/${initial.id}`, () => HttpResponse.json(current)),
    http.patch(`/api/items/${initial.id}`, async ({ request }) => {
      const body = (await request.json()) as PatchItemBody;
      patches.push(body);
      current = applyServerPatch(current, body);
      return HttpResponse.json(current);
    }),
    http.get('/api/people', () => HttpResponse.json(directory)),
    http.post('/api/people', async ({ request }) => {
      const body = (await request.json()) as { name: string };
      created.push(body);
      const person: Person = { id: nextPersonId++, name: body.name, notes: null };
      directory.push(person);
      return HttpResponse.json({ id: person.id, name: person.name }, { status: 201 });
    }),
    http.post(`/api/items/${initial.id}/people`, async ({ request }) => {
      const body = (await request.json()) as LinkPersonBody;
      links.push(body);
      const person = directory.find((p) => p.id === body.personId);
      current = {
        ...current,
        people: [
          ...current.people,
          { id: body.personId, name: person?.name ?? 'Unknown', role: body.role },
        ],
      };
      return new HttpResponse(null, { status: 204 });
    }),
  );

  return { patches, links, created };
}

function applyServerPatch(item: ItemDetail, body: PatchItemBody): ItemDetail {
  const next: ItemDetail = { ...item };
  if (body.title !== undefined) next.title = body.title;
  if (body.description !== undefined) next.description = body.description;
  if (body.transcription_diplomatic !== undefined) {
    next.transcription_diplomatic = body.transcription_diplomatic;
  }
  if (body.transcription_normalized !== undefined) {
    next.transcription_normalized = body.transcription_normalized;
  }
  if (body.status !== undefined) next.status = body.status;
  if (body.date !== undefined) {
    const normalized = normalizeFuzzyDate({
      start: body.date.start ?? null,
      precision: body.date.precision ?? item.date_precision,
    });
    next.date_start = normalized.start;
    next.date_end = normalized.end;
    next.date_precision = normalized.precision;
  }
  return next;
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const qc = makeQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, qc };
}

async function settled(qc: ReturnType<typeof makeQueryClient>) {
  await waitFor(() => {
    expect(qc.isMutating()).toBe(0);
    expect(qc.isFetching()).toBe(0);
  });
}

async function loadWorkspace(item: ItemDetail, people: Person[] = []) {
  const scenario = setupItemScenario(item, people);
  const rendered = renderAt(`/items/${item.id}`);
  await screen.findByRole('button', { name: 'Save' });
  return { ...scenario, ...rendered };
}

describe('Workspace', () => {
  it('renders AI fields', async () => {
    await loadWorkspace(baseItem);

    expect(screen.getByTestId('confidence-overall')).toHaveTextContent('medium');
    expect(screen.getByText(/Some words are hard to read/)).toBeInTheDocument();

    // Diplomatic is the default tab.
    expect(
      screen.getByRole('textbox', { name: /diplomatic transcription/i }),
    ).toHaveValue('Dear famly [?]\nI am well');
    await userEvent.click(screen.getByRole('tab', { name: 'Normalized' }));
    expect(
      screen.getByRole('textbox', { name: /normalized transcription/i }),
    ).toHaveValue('Dear family, I am well.');

    // Flagged span text + reason are listed.
    expect(screen.getByText('famly [?]')).toBeInTheDocument();
    expect(screen.getByText(/possible misspelling of family/)).toBeInTheDocument();
  });

  it('tab toggle switches transcription', async () => {
    await loadWorkspace(baseItem);

    expect(
      screen.getByRole('textbox', { name: /diplomatic transcription/i }),
    ).toHaveValue('Dear famly [?]\nI am well');
    expect(
      screen.queryByRole('textbox', { name: /normalized transcription/i }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Normalized' }));

    expect(
      screen.getByRole('textbox', { name: /normalized transcription/i }),
    ).toHaveValue('Dear family, I am well.');
  });

  it('save sends only changed fields', async () => {
    const { patches, qc } = await loadWorkspace(baseItem);

    const title = screen.getByRole('textbox', { name: /title/i });
    await userEvent.clear(title);
    await userEvent.type(title, 'V-mail from Grandpa');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ title: 'V-mail from Grandpa' });
    await settled(qc);
  });

  it('save sends date with precision', async () => {
    const { patches, qc } = await loadWorkspace(baseItem);

    fireEvent.change(screen.getByLabelText('Date', { selector: 'input' }), {
      target: { value: '1943-01-01' },
    });
    await userEvent.selectOptions(screen.getByLabelText('Precision'), 'year');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ date: { start: '1943-01-01', precision: 'year' } });
    await settled(qc);
  });

  it('unknown precision disables date input and nulls start', async () => {
    const { patches, qc } = await loadWorkspace(baseItem);

    await userEvent.selectOptions(screen.getByLabelText('Precision'), 'unknown');
    expect(screen.getByLabelText('Date', { selector: 'input' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ date: { start: null, precision: 'unknown' } });
    await settled(qc);
  });

  it('date preview uses normalizeFuzzyDate', async () => {
    await loadWorkspace(baseItem);

    fireEvent.change(screen.getByLabelText('Date', { selector: 'input' }), {
      target: { value: '1943-01-01' },
    });
    await userEvent.selectOptions(screen.getByLabelText('Precision'), 'year');

    const expected = normalizeFuzzyDate({ start: '1943-01-01', precision: 'year' });
    expect(expected).toEqual({ start: '1943-01-01', end: '1943-12-31', precision: 'year' });
    const preview = screen.getByTestId('date-preview');
    expect(preview).toHaveTextContent('1943');
    expect(preview).toHaveTextContent('Dec 31');
  });

  it('approve disabled on pending with reason', async () => {
    await loadWorkspace({
      ...baseItem,
      status: 'pending',
      transcription_diplomatic: null,
      transcription_normalized: null,
      ai_confidence: null,
    });

    expect(screen.getByRole('button', { name: 'Mark reviewed' })).toBeDisabled();
    expect(screen.getByText(/item hasn't been transcribed yet/)).toBeInTheDocument();
  });

  it('approve flips status on transcribed', async () => {
    const { patches, qc } = await loadWorkspace(baseItem);
    expect(screen.getByText('transcribed')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ status: 'reviewed' });
    expect(await screen.findByText('reviewed')).toBeInTheDocument();
    await settled(qc);
  });

  it('409 on approve surfaces message', async () => {
    setupItemScenario(baseItem);
    server.use(
      http.patch('/api/items/1', () =>
        HttpResponse.json({ error: 'item not transcribed yet' }, { status: 409 }),
      ),
    );
    const { qc } = renderAt('/items/1');
    await screen.findByRole('button', { name: 'Save' });

    await userEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));

    expect(
      await screen.findByText(/item hasn't been transcribed yet/),
    ).toBeInTheDocument();
    // Rollback: still transcribed, not reviewed.
    expect(screen.getByText('transcribed')).toBeInTheDocument();
    await settled(qc);
  });

  it('link existing person', async () => {
    const { links, qc } = await loadWorkspace(baseItem, [
      { id: 5, name: 'Ada Lovelace', notes: null },
    ]);

    await userEvent.selectOptions(await screen.findByLabelText('Person'), '5');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'author');
    await userEvent.click(screen.getByRole('button', { name: 'Link person' }));

    await waitFor(() => expect(links).toHaveLength(1));
    expect(links[0]).toEqual({ personId: 5, role: 'author' });
    const chips = screen.getByTestId('people-chips');
    expect(await within(chips).findByText('Ada Lovelace')).toBeInTheDocument();
    await settled(qc);
  });

  it('create person inline then link', async () => {
    const { created, links, qc } = await loadWorkspace(baseItem);

    await userEvent.type(screen.getByLabelText('New person name'), 'Charles Babbage');
    await userEvent.click(screen.getByRole('button', { name: 'Create and link' }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({ name: 'Charles Babbage' });
    await waitFor(() => expect(links).toHaveLength(1));
    expect(links[0]).toEqual({ personId: 100, role: 'subject' });
    await settled(qc);
  });

  it('null transcription empty state', async () => {
    await loadWorkspace({ ...baseItem, transcription_diplomatic: null });

    expect(screen.getByText(/no text detected/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: /diplomatic transcription/i }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Start transcription' }));

    expect(
      screen.getByRole('textbox', { name: /diplomatic transcription/i }),
    ).toHaveValue('');
  });
});
