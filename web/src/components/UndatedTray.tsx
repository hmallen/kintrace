import { Link } from 'react-router-dom';
import type { ItemSummary } from '@shared/api.js';

// Labeled tray for items toTimelineData can't place on the axis (unknown
// precision / null start). Purely presentational: items in, Link-based
// navigation to the workspace out. Renders nothing when there's nothing
// undated. (Axis items navigate too, via TimelineView's select handler.)
export function UndatedTray({ items }: { items: ItemSummary[] }) {
  if (items.length === 0) return null;

  return (
    <aside className="undated-tray" aria-label="Undated items">
      <h3>
        {items.length} undated {items.length === 1 ? 'item' : 'items'}
      </h3>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <Link to={`/items/${item.id}`}>{item.title ?? 'Untitled'}</Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
