import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { Person } from '@shared/api.js';
import { makeQueryClient } from '../queryClient';
import { routes } from '../router';
import { server } from '../test/msw';
import { peopleHandler } from '../test/handlers';

const people: Person[] = [
  { id: 1, name: 'Ada Lovelace', notes: 'Mathematician and writer' },
  { id: 2, name: 'Charles Babbage', notes: null },
];

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

// Stateful people API: GET serves the list, POST captures the exact body,
// appends the new person, and answers with a CreatePersonResult.
function statefulPeopleApi(initial: Person[]) {
  const list = [...initial];
  const bodies: unknown[] = [];
  server.use(
    http.get('/api/people', () => HttpResponse.json(list)),
    http.post('/api/people', async ({ request }) => {
      const body = (await request.json()) as { name: string };
      bodies.push(body);
      const person: Person = { id: list.length + 100, name: body.name, notes: null };
      list.push(person);
      return HttpResponse.json({ id: person.id, name: person.name });
    }),
  );
  return bodies;
}

describe('People', () => {
  it('lists people', async () => {
    server.use(peopleHandler(people));
    renderAt('/people');

    expect(await screen.findByRole('link', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Charles Babbage' })).toBeInTheDocument();
    expect(screen.getByText('Mathematician and writer')).toBeInTheDocument();
  });

  it('create person', async () => {
    const bodies = statefulPeopleApi([]);
    renderAt('/people');

    await userEvent.type(await screen.findByLabelText(/name/i), 'Ada');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(bodies).toStrictEqual([{ name: 'Ada' }]);
  });

  it('create with notes', async () => {
    const bodies = statefulPeopleApi([]);
    renderAt('/people');

    await userEvent.type(await screen.findByLabelText(/name/i), 'Ada');
    await userEvent.type(screen.getByLabelText(/notes/i), 'Countess of Lovelace');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(bodies).toStrictEqual([{ name: 'Ada', notes: 'Countess of Lovelace' }]);
  });

  it('person click navigates to filtered library', async () => {
    server.use(peopleHandler(people));
    const router = renderAt('/people');

    await userEvent.click(await screen.findByRole('link', { name: 'Ada Lovelace' }));

    await waitFor(() => {
      expect(router.state.location.pathname + router.state.location.search).toBe(
        '/?personId=1',
      );
    });
    expect(await screen.findByText(/filtered by person/i)).toBeInTheDocument();
  });

  it('merges a selected duplicate into the person to keep', async () => {
    const list = [...people];
    const bodies: unknown[] = [];
    server.use(
      http.get('/api/people', () => HttpResponse.json(list)),
      http.post('/api/people/merge', async ({ request }) => {
        const body = (await request.json()) as { keepId: number; duplicateId: number };
        bodies.push(body);
        const duplicateIndex = list.findIndex((person) => person.id === body.duplicateId);
        list.splice(duplicateIndex, 1);
        return HttpResponse.json(list.find((person) => person.id === body.keepId));
      }),
    );
    renderAt('/people');

    await userEvent.selectOptions(await screen.findByLabelText(/^keep/i), '1');
    await userEvent.selectOptions(screen.getByLabelText(/merge duplicate/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /merge people/i }));

    await waitFor(() => expect(screen.queryByText('Charles Babbage')).not.toBeInTheDocument());
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(bodies).toEqual([{ keepId: 1, duplicateId: 2 }]);
  });
});
