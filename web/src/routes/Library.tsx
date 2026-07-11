import { useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { StatusSchema } from '@shared/api.js';
import type { ItemSummary, Status } from '@shared/api.js';
import {
  useAddItemToGroup,
  useCreateItemGroup,
  useDeleteItem,
  useItemGroups,
  useItems,
  type ItemFilters,
} from '../api/hooks';
import { MediaTypeIcon } from '../components/MediaTypeIcon';
import { StatusChip } from '../components/StatusChip';
import { Thumbnail } from '../components/Thumbnail';
import { formatDateLabel } from '../timeline/translate';

const STATUS_OPTIONS: Status[] = ['pending', 'transcribed', 'reviewed'];
const ITEM_DRAG_TYPE = 'application/x-kintrace-item';

function parseStatus(value: string | null): Status | undefined {
  const parsed = StatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parsePersonId(value: string | null): number | undefined {
  if (value === null) return undefined;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export function Library() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = parseStatus(searchParams.get('status'));
  const personId = parsePersonId(searchParams.get('personId'));

  const filters: ItemFilters = {};
  if (status !== undefined) filters.status = status;
  if (personId !== undefined) filters.personId = personId;

  const { data: items, isPending } = useItems(filters);
  const { data: groups = [], isPending: groupsPending } = useItemGroups();
  const deleteItem = useDeleteItem();
  const createGroup = useCreateItemGroup();
  const addToGroup = useAddItemToGroup();
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const visibleIds = new Set(items?.map(({ id }) => id) ?? []);
  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter(({ id }) => visibleIds.has(id)) }))
    .filter((group) => group.items.length > 0);
  const groupedIds = new Set(visibleGroups.flatMap(({ items: members }) => members.map(({ id }) => id)));
  const ungroupedItems = items?.filter(({ id }) => !groupedIds.has(id)) ?? [];

  function handleDelete(itemId: number, title: string) {
    if (!window.confirm(`Delete “${title}” from the library?`)) return;
    deleteItem.mutate(itemId);
  }

  function setStatusFilter(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === '') {
      next.delete('status');
    } else {
      next.set('status', value);
    }
    setSearchParams(next);
  }

  function clearPersonFilter() {
    const next = new URLSearchParams(searchParams);
    next.delete('personId');
    setSearchParams(next);
  }

  function draggedItemId(event: DragEvent): number | null {
    const itemId = Number(event.dataTransfer.getData(ITEM_DRAG_TYPE));
    return Number.isSafeInteger(itemId) && itemId > 0 ? itemId : null;
  }

  function dropOnGroup(event: DragEvent, groupId: number) {
    event.preventDefault();
    setDropTarget(null);
    const itemId = draggedItemId(event);
    const group = groups.find(({ id }) => id === groupId);
    if (itemId === null || group?.items.some(({ id }) => id === itemId)) return;
    addToGroup.mutate({ groupId, itemId });
  }

  function dropOnItem(event: DragEvent, targetItemId: number) {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const sourceItemId = draggedItemId(event);
    if (sourceItemId === null || sourceItemId === targetItemId) return;
    const targetGroup = groups.find(({ items: members }) =>
      members.some(({ id }) => id === targetItemId)
    );
    if (targetGroup) {
      addToGroup.mutate({ groupId: targetGroup.id, itemId: sourceItemId });
    } else {
      createGroup.mutate({ itemIds: [targetItemId, sourceItemId] });
    }
  }

  function renderItem(item: ItemSummary) {
    const title = item.title ?? 'Untitled';
    const targetKey = `item-${item.id}`;
    return (
      <li
        key={item.id}
        className={dropTarget === targetKey ? 'is-drop-target' : undefined}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(ITEM_DRAG_TYPE, String(item.id));
        }}
        onDragEnd={() => setDropTarget(null)}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          setDropTarget(targetKey);
        }}
        onDragLeave={() => setDropTarget((current) => current === targetKey ? null : current)}
        onDrop={(event) => dropOnItem(event, item.id)}
      >
        <Link
          to={{ pathname: `/items/${item.id}`, search: searchParams.toString() }}
          className="item-card"
        >
          <Thumbnail itemId={item.id} alt={title} mediaType={item.media_type} />
          <p className="item-card-title">{title}</p>
          <p className="item-card-meta">
            <StatusChip status={item.status} /> <MediaTypeIcon type={item.media_type} />
          </p>
          <p className="item-card-date">
            {formatDateLabel(item.date_start, item.date_precision)}
          </p>
        </Link>
        <button
          type="button"
          className="item-delete"
          disabled={deleteItem.isPending}
          onClick={() => handleDelete(item.id, title)}
        >
          Delete
        </button>
      </li>
    );
  }

  return (
    <section>
      <h2>Library</h2>
      <div className="filter-bar">
        <label>
          Status{' '}
          <select value={status ?? ''} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">all</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      {personId !== undefined && (
        <p>
          Filtered by person #{personId}{' '}
          <button type="button" onClick={clearPersonFilter}>
            Clear filter
          </button>
        </p>
      )}
      <p className="hint">Drag an item onto another item or a group to keep related views together.</p>
      {(isPending || groupsPending) && <p>Loading items…</p>}
      {items && items.length === 0 && <p>No items found.</p>}
      {items && items.length > 0 && (
        <div className="library-groups">
          {visibleGroups.map((group) => {
            const targetKey = `group-${group.id}`;
            return (
              <section
                key={group.id}
                className={`library-group${dropTarget === targetKey ? ' is-drop-target' : ''}`}
                aria-labelledby={`library-group-${group.id}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropTarget(targetKey);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDropTarget((current) => current === targetKey ? null : current);
                  }
                }}
                onDrop={(event) => dropOnGroup(event, group.id)}
              >
                <div className="library-group-heading">
                  <h3 id={`library-group-${group.id}`}>{group.label ?? 'Unnamed group'}</h3>
                  <span>{group.items.length} {group.items.length === 1 ? 'item' : 'items'}</span>
                </div>
                <ul className="card-grid">{group.items.map(renderItem)}</ul>
              </section>
            );
          })}
          {ungroupedItems.length > 0 && (
            <section className="library-ungrouped" aria-labelledby="library-ungrouped-heading">
              {visibleGroups.length > 0 && <h3 id="library-ungrouped-heading">Ungrouped items</h3>}
              <ul className="card-grid">{ungroupedItems.map(renderItem)}</ul>
            </section>
          )}
        </div>
      )}
      {(deleteItem.isError || createGroup.isError || addToGroup.isError) && (
        <p role="alert">
          {deleteItem.isError
            ? `Failed to delete item: ${deleteItem.error.message}`
            : `Failed to group item: ${(createGroup.error ?? addToGroup.error)?.message}`}
        </p>
      )}
    </section>
  );
}
