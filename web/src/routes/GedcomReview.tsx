import { useMemo, useState } from 'react';
import type { GedcomReviewGroup, GedcomReviewItem } from '@shared/api.js';
import {
  useGedcomReviewQueue,
  useReviewGedcomGroup,
  useReviewGedcomItem,
  useReviewGedcomSelection,
} from '../api/hooks';

const GROUP_TITLES: Record<GedcomReviewGroup, string> = {
  people: 'People',
  relationships: 'Relationships',
  events: 'Events',
};

interface IndividualFilter {
  key: string;
  importId: number;
  xref: string;
  label: string;
}

function belongsToIndividual(item: GedcomReviewItem, individual: IndividualFilter): boolean {
  if (item.importId !== individual.importId) return false;
  if (item.group === 'people') return item.gedcomXref === individual.xref;
  if (item.group === 'events') return item.payload.personXref === individual.xref;
  return item.payload.personXref === individual.xref
    || item.payload.relatedPersonXref === individual.xref;
}

function ReviewItem({
  item,
  selected,
  disabled,
  onSelect,
  onReview,
}: {
  item: GedcomReviewItem;
  selected: boolean;
  disabled: boolean;
  onSelect: (selected: boolean) => void;
  onReview: (action: 'accept' | 'reject') => void;
}) {
  const details = Object.entries(item.payload).filter(([, value]) => value !== null && value !== 'unknown');
  const pending = item.status === 'pending';
  return (
    <li className="gedcom-review-item">
      <input
        type="checkbox"
        aria-label={`Select ${item.label}`}
        checked={selected}
        disabled={!pending || disabled}
        onChange={(event) => onSelect(event.target.checked)}
      />
      <details className="gedcom-item-details">
        <summary>{item.label}</summary>
        <dl>
          {details.map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      </details>
      {pending ? (
        <span className="gedcom-item-actions">
          <button type="button" disabled={disabled} onClick={() => onReview('accept')}>Accept</button>
          <button type="button" disabled={disabled} onClick={() => onReview('reject')}>Reject</button>
        </span>
      ) : (
        <span className={`gedcom-review-status gedcom-review-status--${item.status}`}>
          {item.status}
        </span>
      )}
    </li>
  );
}

export function GedcomReview() {
  const queue = useGedcomReviewQueue();
  const reviewItem = useReviewGedcomItem();
  const reviewGroup = useReviewGedcomGroup();
  const reviewSelection = useReviewGedcomSelection();
  const [individualKey, setIndividualKey] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

  const individuals = useMemo<IndividualFilter[]>(() => {
    if (!queue.data) return [];
    const people = queue.data.groups.find(({ group }) => group === 'people')?.items ?? [];
    return people
      .filter((item): item is GedcomReviewItem & { gedcomXref: string } => item.gedcomXref !== null)
      .map((item) => ({
        key: `${item.importId}:${item.gedcomXref}`,
        importId: item.importId,
        xref: item.gedcomXref,
        label: item.label,
      }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.xref.localeCompare(b.xref));
  }, [queue.data]);

  if (queue.isPending) return <p>Loading GEDCOM review queue…</p>;
  if (queue.error) throw queue.error;

  const individual = individuals.find(({ key }) => key === individualKey);
  const visibleGroups = queue.data.groups.map(({ group, items }) => ({
    group,
    items: individual ? items.filter((item) => belongsToIndividual(item, individual)) : items,
  }));
  const allItems = queue.data.groups.flatMap(({ items }) => items);
  const itemCount = allItems.length;
  const pendingIds = new Set(allItems.filter((item) => item.status === 'pending').map((item) => item.id));
  const selectedPendingIds = [...selectedIds].filter((id) => pendingIds.has(id));
  const visiblePendingIds = visibleGroups
    .flatMap(({ items }) => items)
    .filter((item) => item.status === 'pending')
    .map((item) => item.id);
  const busy = reviewItem.isPending || reviewGroup.isPending || reviewSelection.isPending;

  function setItemSelected(id: number, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds((current) => new Set([...current, ...visiblePendingIds]));
  }

  function reviewSelected(action: 'accept' | 'reject') {
    reviewSelection.mutate(
      { ids: selectedPendingIds, action },
      { onSuccess: () => setSelectedIds(new Set()) },
    );
  }

  return (
    <section className="gedcom-review-page">
      <h2>GEDCOM review queue</h2>
      <p className="hint">
        Filter by an individual to collect their person, relationship, and event records together.
        Accepted selections are applied in dependency order.
      </p>

      {itemCount === 0 ? (
        <p>No GEDCOM records are waiting for review.</p>
      ) : (
        <div className="gedcom-review-toolbar">
          <label>
            Individual{' '}
            <select value={individualKey} onChange={(event) => setIndividualKey(event.target.value)}>
              <option value="">All individuals</option>
              {individuals.map((person) => (
                <option key={person.key} value={person.key}>
                  {person.label} ({person.xref})
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={visiblePendingIds.length === 0 || busy} onClick={selectAllVisible}>
            {individual ? `Select all records for ${individual.label}` : 'Select all visible pending'}
          </button>
          <button type="button" disabled={selectedPendingIds.length === 0 || busy} onClick={() => setSelectedIds(new Set())}>
            Clear selection
          </button>
          <span className="gedcom-selection-count">{selectedPendingIds.length} selected</span>
          <button type="button" disabled={selectedPendingIds.length === 0 || busy} onClick={() => reviewSelected('accept')}>
            Accept selected
          </button>
          <button type="button" disabled={selectedPendingIds.length === 0 || busy} onClick={() => reviewSelected('reject')}>
            Reject selected
          </button>
        </div>
      )}

      <div className="gedcom-review-groups">
        {visibleGroups.map(({ group, items }) => {
          const pending = items.filter((item) => item.status === 'pending').length;
          return (
            <details className="gedcom-review-group" key={group} open>
              <summary>
                <h3 id={`gedcom-review-${group}`}>{GROUP_TITLES[group]} ({pending} pending)</h3>
                <span>{items.length} shown</span>
              </summary>
              {!individual && pending > 0 && (
                <div className="gedcom-group-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => reviewGroup.mutate({ group, action: 'accept' })}
                  >
                    Accept all {GROUP_TITLES[group].toLowerCase()}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => reviewGroup.mutate({ group, action: 'reject' })}
                  >
                    Reject all
                  </button>
                </div>
              )}
              {items.length > 0 ? (
                <ul className="gedcom-review-list">
                  {items.map((item) => (
                    <ReviewItem
                      key={item.id}
                      item={item}
                      selected={selectedIds.has(item.id) && item.status === 'pending'}
                      disabled={busy}
                      onSelect={(selected) => setItemSelected(item.id, selected)}
                      onReview={(action) => reviewItem.mutate({ id: item.id, action })}
                    />
                  ))}
                </ul>
              ) : (
                <p className="hint">No matching {GROUP_TITLES[group].toLowerCase()}.</p>
              )}
            </details>
          );
        })}
      </div>
      {(reviewItem.error || reviewGroup.error || reviewSelection.error) && (
        <p role="alert">
          {(reviewItem.error || reviewGroup.error || reviewSelection.error)?.message}
        </p>
      )}
    </section>
  );
}
