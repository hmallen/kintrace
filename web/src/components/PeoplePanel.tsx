import { useRef, useState } from 'react';
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
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  // Names that were created but not yet linked (a create-ok/link-failed chip
  // click): normalized name → created personId. Reused on retry so we resume at
  // the link step instead of creating a duplicate person.
  const createdIds = useRef(new Map<string, number>());

  async function handleSuggestion(name: string) {
    const key = name.trim().toLowerCase();
    setSuggestionError(null);
    try {
      let id = createdIds.current.get(key);
      if (id === undefined) {
        const person = await createPerson.mutateAsync({ name });
        id = person.id;
        createdIds.current.set(key, id);
      }
      await linkPerson.mutateAsync({ personId: id, role: 'subject' });
      createdIds.current.delete(key);
    } catch (err) {
      setSuggestionError(
        `Couldn't add ${name}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
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
      <h3>People</h3>
      <div data-testid="people-chips">
        {ROLES.map((r) => {
          const members = item.people.filter((p) => p.role === r);
          if (members.length === 0) return null;
          return (
            <p key={r} style={{ margin: '0.25rem 0' }}>
              <strong>{r}:</strong>{' '}
              {members.map((p) => (
                <span key={`${p.id}-${p.role}`} className="person-chip">
                  {p.name}
                </span>
              ))}
            </p>
          );
        })}
        {item.people.length === 0 && <p className="hint">No people linked.</p>}
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
              className="suggestion-chip"
            >
              {name} +
            </button>
          ))}
        </p>
      )}

      {suggestionError && (
        <p role="alert" style={{ margin: '0.25rem 0' }}>
          {suggestionError}
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
