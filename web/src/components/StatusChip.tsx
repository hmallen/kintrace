import type { Status } from '@shared/api.js';

const COLORS: Record<Status, string> = {
  pending: '#92400e',
  transcribed: '#1e40af',
  reviewed: '#166534',
};

export function StatusChip({ status }: { status: Status }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0 0.5em',
        borderRadius: '1em',
        border: `1px solid ${COLORS[status]}`,
        color: COLORS[status],
        fontSize: '0.75rem',
      }}
    >
      {status}
    </span>
  );
}
