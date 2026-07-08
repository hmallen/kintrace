import type { Status } from '@shared/api.js';

// Catalog-stamp status marker; hues come from the status tokens in theme.css
// (shared with the timeline's precision shapes).
export function StatusChip({ status }: { status: Status }) {
  return <span className={`status-chip status-${status}`}>{status}</span>;
}
