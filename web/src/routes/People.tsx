import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { CreatePersonBody } from '@shared/api.js';
import { useCreatePerson, usePeople } from '../api/hooks';

export function People() {
  const { data: people, isPending, isError, error } = usePeople();
  const createPerson = useCreatePerson();

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === '') return;
    // Notes are omitted entirely when empty — the body carries only { name }.
    const body: CreatePersonBody = { name: trimmedName };
    const trimmedNotes = notes.trim();
    if (trimmedNotes !== '') body.notes = trimmedNotes;
    try {
      await createPerson.mutateAsync(body);
      setName('');
      setNotes('');
    } catch {
      // surfaced via createPerson.error below
    }
  }

  return (
    <section>
      <h2>People</h2>

      <form onSubmit={handleSubmit} className="filter-bar">
        <label>
          Name{' '}
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>{' '}
        <label>
          Notes{' '}
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>{' '}
        <button type="submit" disabled={createPerson.isPending}>
          Create person
        </button>
      </form>
      {createPerson.isError && (
        <p role="alert">Failed to create person: {createPerson.error.message}</p>
      )}

      {isPending && <p>Loading people…</p>}
      {isError && <p role="alert">Failed to load people: {error.message}</p>}
      {people && people.length === 0 && <p>No people yet.</p>}
      {people && people.length > 0 && (
        <ul className="person-list">
          {people.map((person) => (
            <li key={person.id}>
              <Link to={`/?personId=${person.id}`}>{person.name}</Link>
              {person.notes !== null && person.notes !== '' && (
                <p className="person-notes">{person.notes}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
