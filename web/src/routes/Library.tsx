import { Link, useSearchParams } from 'react-router-dom';
import { StatusSchema } from '@shared/api.js';
import type { Status } from '@shared/api.js';
import { useItems, type ItemFilters } from '../api/hooks';
import { MediaTypeIcon } from '../components/MediaTypeIcon';
import { StatusChip } from '../components/StatusChip';
import { Thumbnail } from '../components/Thumbnail';
import { formatDateLabel } from '../timeline/translate';

const STATUS_OPTIONS: Status[] = ['pending', 'transcribed', 'reviewed'];

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
      {isPending && <p>Loading items…</p>}
      {items && items.length === 0 && <p>No items found.</p>}
      {items && items.length > 0 && (
        <ul className="card-grid">
          {items.map((item) => {
            const title = item.title ?? 'Untitled';
            return (
              <li key={item.id}>
                <Link to={`/items/${item.id}`} className="item-card">
                  <Thumbnail itemId={item.id} alt={title} mediaType={item.media_type} />
                  <p className="item-card-title">{title}</p>
                  <p className="item-card-meta">
                    <StatusChip status={item.status} /> <MediaTypeIcon type={item.media_type} />
                  </p>
                  <p className="item-card-date">
                    {formatDateLabel(item.date_start, item.date_precision)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
