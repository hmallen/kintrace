import type { AiConfidence } from '@shared/api.js';

export interface FlaggedSpansListProps {
  spans: AiConfidence['flaggedSpans'];
}

export function FlaggedSpansList({ spans }: FlaggedSpansListProps) {
  if (spans.length === 0) return null;

  return (
    <section>
      <h3 style={{ fontSize: '1rem' }}>Flagged spans</h3>
      <ul>
        {spans.map((span, i) => (
          <li key={i}>
            <strong>{span.text}</strong> — {span.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}
