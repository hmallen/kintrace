import { isSpanResolved } from './decorations';

export interface FlagsSidebarProps {
  spans: { text: string; reason: string }[];
  /** Current diplomatic transcription text; spans absent from it are "resolved". */
  value: string;
  onSpanClick: (text: string) => void;
}

export function FlagsSidebar({ spans, value, onSpanClick }: FlagsSidebarProps) {
  if (spans.length === 0) return null;

  return (
    <section aria-label="Flagged spans">
      <h3>Flagged spans</h3>
      <ul style={{ listStyle: 'none', paddingLeft: 0, marginTop: 0 }}>
        {spans.map((span, i) => {
          const resolved = isSpanResolved(value, span.text);
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onSpanClick(span.text)}
                aria-label={`${span.text} — ${span.reason}${resolved ? ' (resolved)' : ''}`}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '0.125rem 0',
                  cursor: 'pointer',
                  textAlign: 'left',
                  // Inline because resolution state is per-item and asserted in tests.
                  textDecoration: resolved ? 'line-through' : 'none',
                  opacity: resolved ? 0.6 : 1,
                }}
              >
                <strong>{span.text}</strong> — {span.reason}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
