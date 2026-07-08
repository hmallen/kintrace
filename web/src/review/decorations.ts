export interface SpanMatch {
  from: number; // inclusive start offset in the text
  to: number; // exclusive end offset
  kind: 'flagged' | 'marker';
  reason: string; // flagged: the span's reason; marker: a description of the marker type
}

export function findFlaggedSpans(
  text: string,
  flaggedSpans: { text: string; reason: string }[],
): SpanMatch[] {
  const matches: SpanMatch[] = [];
  for (const span of flaggedSpans) {
    if (span.text === '') continue;
    let index = text.indexOf(span.text);
    while (index !== -1) {
      matches.push({ from: index, to: index + span.text.length, kind: 'flagged', reason: span.reason });
      index = text.indexOf(span.text, index + span.text.length);
    }
  }
  return matches;
}

const MARKER_RE = /\[illegible\]|\[\?\]|\[possibly[^\]]*\]/g;

export function findUncertaintyMarkers(text: string): SpanMatch[] {
  const matches: SpanMatch[] = [];
  for (const match of text.matchAll(MARKER_RE)) {
    const reason =
      match[0] === '[illegible]'
        ? 'illegible passage'
        : match[0] === '[?]'
          ? 'uncertain word'
          : 'uncertain name';
    matches.push({ from: match.index, to: match.index + match[0].length, kind: 'marker', reason });
  }
  return matches;
}

export function buildDecorations(
  text: string,
  flaggedSpans: { text: string; reason: string }[],
): SpanMatch[] {
  return [...findFlaggedSpans(text, flaggedSpans), ...findUncertaintyMarkers(text)].sort(
    (a, b) => a.from - b.from || a.to - b.to,
  );
}

export function isSpanResolved(text: string, spanText: string): boolean {
  return !text.includes(spanText);
}
