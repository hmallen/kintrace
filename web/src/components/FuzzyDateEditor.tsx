import { PRECISION_VALUES, normalizeFuzzyDate, type FuzzyDate } from '@shared/dates.js';
import type { Precision } from '@shared/api.js';

export interface FuzzyDateEditorValue {
  start: string | null;
  precision: Precision;
}

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function shortDate(iso: string): string {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number);
  return `${SHORT_MONTHS[month - 1]} ${day}, ${year}`;
}

function previewText(date: FuzzyDate): string {
  if (date.start === null || date.end === null) return 'Undated / no date';
  return `${shortDate(date.start)} – ${shortDate(date.end)}`;
}

export interface FuzzyDateEditorProps {
  value: FuzzyDateEditorValue;
  onChange: (value: FuzzyDateEditorValue) => void;
}

export function FuzzyDateEditor({ value, onChange }: FuzzyDateEditorProps) {
  const normalized = normalizeFuzzyDate({ start: value.start, precision: value.precision });

  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
      <label>
        Date{' '}
        <input
          type="date"
          value={value.start ?? ''}
          disabled={value.precision === 'unknown'}
          onChange={(e) =>
            onChange({ ...value, start: e.target.value === '' ? null : e.target.value })
          }
        />
      </label>{' '}
      <label>
        Precision{' '}
        <select
          value={value.precision}
          onChange={(e) => {
            const precision = e.target.value as Precision;
            onChange({
              start: precision === 'unknown' ? null : value.start,
              precision,
            });
          }}
        >
          {PRECISION_VALUES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <p data-testid="date-preview" style={{ margin: '0.25rem 0', color: '#555' }}>
        {previewText(normalized)}
      </p>
    </fieldset>
  );
}
