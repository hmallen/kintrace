import type { Precision } from '@shared/api.js';

// Fixed month names (no Intl) so labels are deterministic across environments.
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatDateLabel(dateStart: string | null, precision: Precision): string {
  if (dateStart === null || precision === 'unknown') return 'Undated';
  const [year = 0, month = 1, day = 1] = dateStart.split('-').map(Number);
  switch (precision) {
    case 'exact':
      return `${MONTHS[month - 1]} ${day}, ${year}`;
    case 'month':
      return `${MONTHS[month - 1]} ${year}`;
    case 'year':
      return String(year);
    case 'decade':
      return `c. ${Math.floor(year / 10) * 10}s`;
  }
}
