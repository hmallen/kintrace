import { useState } from 'react';
import { PersonRoleSchema } from '@shared/api.js';
import type { ItemDetail, PersonRole } from '@shared/api.js';
import { useCreatePerson, useLinkPerson, usePeople } from '../api/hooks';
import { suggestibleNames } from '../review/aiNames';

const ROLES = PersonRoleSchema.options;

export function PeoplePanel({ item }: { item: ItemDetail }) {
  const { data: people } = usePeople();
  const linkPerson = useLinkPerson(item.id);
  const createPerson = useCreatePerson();
  const suggestions = suggestibleNames(item.ai_names, item.people);

  const [personId, setPersonId] = useState('');
  const [role, setRole] = useState<PersonRole>('subject');
  const [newName, setNewName] = useState('');

  async function handleSuggestion(name: string) {
    try {
      const person = await createPerson.mutateAsync({ name });
      await linkPerson.mutateAsync({ personId: person.id, role: 'subject' });
    } catch {
      // surfaced via mutation errors below
    }
  }

  async function handleLink() {
    if (personId === '') return;
    try {
      await linkPerson.mutateAsync({ personId: Number(personId), role });
      setPersonId('');
    } catch {
      // surfaced via linkPerson.error below
    }
  }

  async function handleCreateAndLink() {
    const name = newName.trim();
    if (name === '') return;
    try {
      const person = await createPerson.mutateAsync({ name });
      await linkPerson.mutateAsync({ personId: person.id, role });
      setNewName('');
    } catch {
      // surfaced via mutation errors below
    }
  }

  return (
    <section>
      <h3 style={{ fontSize: '1rem' }}>People</h3>
      <div data-testid="people-chips">
        {ROLES.map((r) => {
          const members = item.people.filter((p) => p.role === r);
          if (members.length === 0) return null;
          return (
            <p key={r} style={{ margin: '0.25rem 0' }}>
              <strong>{r}:</strong>{' '}
              {members.map((p) => (
                <span
                  key={`${p.id}-${p.role}`}
                  style={{
                    display: 'inline-block',
                    padding: '0 0.5em',
                    marginRight: '0.25em',
                    borderRadius: '1em',
                    border: '1px solid #888',
                  }}
                >
                  {p.name}
                </span>
              ))}
            </p>
          );
        })}
        {item.people.length === 0 && <p style={{ color: '#777' }}>No people linked.</p>}
      </div>

      {suggestions.length > 0 && (
        <p data-testid="ai-name-suggestions" style={{ margin: '0.25rem 0' }}>
          <strong>Suggested:</strong>{' '}
          {suggestions.map((name) => (
            <button
              key={name.trim().toLowerCase()}
              type="button"
              aria-label={`Add ${name} as subject`}
              title="AI-suggested name — click to create and link as subject"
              onClick={() => handleSuggestion(name)}
              disabled={createPerson.isPending || linkPerson.isPending}
              style={{
                padding: '0 0.5em',
                marginRight: '0.25em',
                borderRadius: '1em',
                border: '1px dashed #888',
                background: 'transparent',
                fontStyle: 'italic',
                cursor: 'pointer',
              }}
            >
              {name} +
            </button>
          ))}
        </p>
      )}

      <p>
        <label>
          Person{' '}
          <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">choose…</option>
            {(people ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Role{' '}
          <select value={role} onChange={(e) => setRole(e.target.value as PersonRole)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>{' '}
        <button type="button" onClick={handleLink} disabled={linkPerson.isPending}>
          Link person
        </button>
      </p>

      <p>
        <label>
          New person name{' '}
          <input value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>{' '}
        <button
          type="button"
          onClick={handleCreateAndLink}
          disabled={createPerson.isPending || linkPerson.isPending}
        >
          Create and link
        </button>
      </p>

      {linkPerson.isError && (
        <p role="alert">Failed to link person: {linkPerson.error.message}</p>
      )}
      {createPerson.isError && (
        <p role="alert">Failed to create person: {createPerson.error.message}</p>
      )}
    </section>
  );
}
