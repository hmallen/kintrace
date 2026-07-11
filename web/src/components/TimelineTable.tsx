import { Link } from 'react-router-dom';
import type { ItemSummary } from '@shared/api.js';
import type { TimelineEntry } from '../timeline/layout';
import { StatusChip } from './StatusChip';

// Screen-reader-first fallback for the visual timeline (WCAG 1.1.1): the same
// entries as an ordinary captioned table, dated rows in date order and undated
// items appended so nothing is dropped.
export function TimelineTable({
  entries,
  undated,
}: {
  entries: TimelineEntry[];
  undated: ItemSummary[];
}) {
  return (
    <div className="timeline-table-scroll">
    <table className="timeline-table">
      <caption>Timeline of archive items and life events, in date order</caption>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Title</th>
          <th scope="col">Kind</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.key}>
            <td>{entry.dateLabel}</td>
            <td>
              {entry.kind === 'item' ? (
                <Link to={`/items/${entry.id}`}>{entry.title}</Link>
              ) : (
                entry.title
              )}
            </td>
            <td>{entry.kind === 'item' ? entry.mediaType : 'Life event'}</td>
            <td>{entry.status !== undefined ? <StatusChip status={entry.status} /> : '—'}</td>
          </tr>
        ))}
        {undated.map((item) => (
          <tr key={`undated-${item.id}`}>
            <td>Undated</td>
            <td>
              <Link to={`/items/${item.id}`}>{item.title ?? 'Untitled'}</Link>
            </td>
            <td>{item.media_type}</td>
            <td>
              <StatusChip status={item.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
