import { useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { StatusSchema } from '@shared/api.js';
import type { ItemGroup, ItemSummary, Status } from '@shared/api.js';
import {
  useAddItemToGroup,
  useCreateItemGroup,
  useDeleteItem,
  useItemGroups,
  useItems,
  useLibraryPersonGroups,
  useLinkItemGroupToPerson,
  type ItemFilters,
} from '../api/hooks';
import { MediaTypeIcon } from '../components/MediaTypeIcon';
import { StatusChip } from '../components/StatusChip';
import { Thumbnail } from '../components/Thumbnail';
import { formatDateLabel } from '../timeline/translate';

const STATUS_OPTIONS: Status[] = ['pending', 'transcribed', 'reviewed'];
const ITEM_DRAG_TYPE = 'application/x-kintrace-item';
const GROUP_DRAG_TYPE = 'application/x-kintrace-item-group';

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
  const groupByPerson = searchParams.get('groupBy') !== 'document';

  const filters: ItemFilters = {};
  if (status !== undefined) filters.status = status;
  if (personId !== undefined) filters.personId = personId;

  const { data: items, isPending } = useItems(filters);
  const { data: groups = [], isPending: groupsPending } = useItemGroups();
  const { data: personGroups = [], isPending: peoplePending } = useLibraryPersonGroups();
  const deleteItem = useDeleteItem();
  const createGroup = useCreateItemGroup();
  const addToGroup = useAddItemToGroup();
  const linkGroupToPerson = useLinkItemGroupToPerson();
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

  function setGroupBy(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === 'document') next.set('groupBy', 'document');
    else next.delete('groupBy');
    setSearchParams(next);
  }

  function draggedItemId(event: DragEvent): number | null {
    const itemId = Number(event.dataTransfer.getData(ITEM_DRAG_TYPE));
    return Number.isSafeInteger(itemId) && itemId > 0 ? itemId : null;
  }

  function draggedGroupId(event: DragEvent): number | null {
    const groupId = Number(event.dataTransfer.getData(GROUP_DRAG_TYPE));
    return Number.isSafeInteger(groupId) && groupId > 0 ? groupId : null;
  }

  function dropOnPerson(event: DragEvent, targetPersonId: number) {
    event.preventDefault();
    setDropTarget(null);
    const groupId = draggedGroupId(event);
    if (groupId === null) return;
    linkGroupToPerson.mutate({ groupId, personId: targetPersonId });
  }

  function dropOnGroup(event: DragEvent, groupId: number) {
    event.preventDefault();
    if (draggedGroupId(event) !== null) return;
    event.stopPropagation();
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

  function renderSubgroup(group: ItemGroup, context = 'all') {
    const targetKey = `group-${group.id}`;
    const headingId = `library-group-${context}-${group.id}`;
    return (
      <section
        key={group.id}
        className={`library-group${dropTarget === targetKey ? ' is-drop-target' : ''}`}
        aria-labelledby={headingId}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.types ?? []).includes(GROUP_DRAG_TYPE)) return;
          event.preventDefault();
          event.stopPropagation();
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
        <div
          className="library-group-heading"
          draggable
          title="Drag this full subgroup into a person group"
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(GROUP_DRAG_TYPE, String(group.id));
          }}
          onDragEnd={() => setDropTarget(null)}
        >
          <h3 id={headingId}>{group.label ?? 'Unnamed group'}</h3>
          <span>{group.items.length} {group.items.length === 1 ? 'item' : 'items'} · drag subgroup</span>
        </div>
        <ul className="card-grid">{group.items.map(renderItem)}</ul>
      </section>
    );
  }

  function groupsForItemIds(itemIds: Set<number>): ItemGroup[] {
    return visibleGroups
      .map((group) => ({ ...group, items: group.items.filter(({ id }) => itemIds.has(id)) }))
      .filter((group) => group.items.length > 0);
  }

  function renderPersonHierarchy() {
    const linkedVisibleIds = new Set(
      personGroups.flatMap(({ itemIds }) => itemIds).filter((id) => visibleIds.has(id)),
    );
    const unassignedIds = new Set([...visibleIds].filter((id) => !linkedVisibleIds.has(id)));
    const unassignedGroups = groupsForItemIds(unassignedIds);
    const unassignedGroupedIds = new Set(
      unassignedGroups.flatMap(({ items: members }) => members.map(({ id }) => id)),
    );
    const unassignedItems = (items ?? []).filter(
      ({ id }) => unassignedIds.has(id) && !unassignedGroupedIds.has(id),
    );

    return (
      <div className="library-person-groups">
        {personGroups.map((person) => {
          const personItemIds = new Set(person.itemIds.filter((id) => visibleIds.has(id)));
          const subgroups = groupsForItemIds(personItemIds);
          const subgroupItemIds = new Set(
            subgroups.flatMap(({ items: members }) => members.map(({ id }) => id)),
          );
          const looseItems = (items ?? []).filter(
            ({ id }) => personItemIds.has(id) && !subgroupItemIds.has(id),
          );
          const targetKey = `person-${person.id}`;
          return (
            <section
              key={person.id}
              className={`library-person-group${dropTarget === targetKey ? ' is-drop-target' : ''}`}
              aria-labelledby={`library-person-${person.id}`}
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
              onDrop={(event) => dropOnPerson(event, person.id)}
            >
              <div className="library-person-heading">
                <h3 id={`library-person-${person.id}`}>{person.name}</h3>
                <span>{personItemIds.size} {personItemIds.size === 1 ? 'item' : 'items'}</span>
              </div>
              <div className="library-person-subgroups">
                {subgroups.map((group) => renderSubgroup(group, `person-${person.id}`))}
                {looseItems.length > 0 && (
                  <section className="library-document-subgroup" aria-label={`${person.name} documents`}>
                    <h4>Documents</h4>
                    <ul className="card-grid">{looseItems.map(renderItem)}</ul>
                  </section>
                )}
                {subgroups.length === 0 && looseItems.length === 0 && (
                  <p className="hint">Drop a document/view subgroup here.</p>
                )}
              </div>
            </section>
          );
        })}
        {(unassignedGroups.length > 0 || unassignedItems.length > 0) && (
          <section className="library-person-group library-unassigned" aria-labelledby="library-unassigned-person">
            <div className="library-person-heading">
              <h3 id="library-unassigned-person">Unassigned</h3>
              <span>{unassignedIds.size} {unassignedIds.size === 1 ? 'item' : 'items'}</span>
            </div>
            <div className="library-person-subgroups">
              {unassignedGroups.map((group) => renderSubgroup(group, 'unassigned'))}
              {unassignedItems.length > 0 && (
                <section className="library-document-subgroup" aria-label="Unassigned documents">
                  <h4>Documents</h4>
                  <ul className="card-grid">{unassignedItems.map(renderItem)}</ul>
                </section>
              )}
            </div>
          </section>
        )}
      </div>
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
        <label>
          Group by{' '}
          <select value={groupByPerson ? 'person' : 'document'} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="person">person, then document/view</option>
            <option value="document">document/view</option>
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
      <p className="hint">
        Drag an item onto another item or subgroup to keep related views together. Drag a subgroup
        heading into a person group to associate every document/view in it with that person.
      </p>
      {(isPending || groupsPending || peoplePending) && <p>Loading items…</p>}
      {items && items.length === 0 && <p>No items found.</p>}
      {items && items.length > 0 && groupByPerson && renderPersonHierarchy()}
      {items && items.length > 0 && !groupByPerson && (
        <div className="library-groups">
          {visibleGroups.map((group) => renderSubgroup(group))}
          {ungroupedItems.length > 0 && (
            <section className="library-ungrouped" aria-labelledby="library-ungrouped-heading">
              {visibleGroups.length > 0 && <h3 id="library-ungrouped-heading">Ungrouped items</h3>}
              <ul className="card-grid">{ungroupedItems.map(renderItem)}</ul>
            </section>
          )}
        </div>
      )}
      {(deleteItem.isError || createGroup.isError || addToGroup.isError || linkGroupToPerson.isError) && (
        <p role="alert">
          {deleteItem.isError
            ? `Failed to delete item: ${deleteItem.error.message}`
            : `Failed to group item: ${(createGroup.error ?? addToGroup.error ?? linkGroupToPerson.error)?.message}`}
        </p>
      )}
    </section>
  );
}
