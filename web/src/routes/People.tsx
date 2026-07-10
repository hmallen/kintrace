import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { CreatePersonBody } from '@shared/api.js';
import { useCreatePerson, useMergePeople, usePeople } from '../api/hooks';

export function People() {
  const { data: people, isPending } = usePeople();
  const createPerson = useCreatePerson();
  const mergePeople = useMergePeople();

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [keepId, setKeepId] = useState('');
  const [duplicateId, setDuplicateId] = useState('');

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

  async function handleMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keep = Number(keepId);
    const duplicate = Number(duplicateId);
    if (!Number.isSafeInteger(keep) || !Number.isSafeInteger(duplicate) || keep === duplicate) return;
    try {
      await mergePeople.mutateAsync({ keepId: keep, duplicateId: duplicate });
      setKeepId('');
      setDuplicateId('');
    } catch {
      // surfaced via mergePeople.error below
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

      {people && people.length > 1 && (
        <form onSubmit={handleMerge} className="deduplicate-people">
          <h3>Merge duplicate records</h3>
          <p className="hint">
            References and missing biographical details move to the person you keep.
          </p>
          <div className="filter-bar">
            <label>
              Keep{' '}
              <select value={keepId} onChange={(event) => setKeepId(event.target.value)} required>
                <option value="">Choose a person</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </label>
            <label>
              Merge duplicate{' '}
              <select
                value={duplicateId}
                onChange={(event) => setDuplicateId(event.target.value)}
                required
              >
                <option value="">Choose a duplicate</option>
                {people.filter((person) => String(person.id) !== keepId).map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={mergePeople.isPending || keepId === '' || duplicateId === ''}
            >
              Merge people
            </button>
          </div>
        </form>
      )}
      {mergePeople.isError && (
        <p role="alert">Failed to merge people: {mergePeople.error.message}</p>
      )}

      {isPending && <p>Loading people…</p>}
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
