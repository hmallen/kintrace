import { useMemo } from 'react';
import { Chrono } from 'react-chrono';
import { API_BASE } from '../api/client';
import type { TimelineEntry } from '../timeline/layout';

interface ChronoItem {
  title?: string;
  cardTitle?: string;
  cardSubtitle?: string;
  media?: { type: 'IMAGE'; name: string; source: { url: string } };
}

// Curated, scroll-driven telling of a (usually person-filtered) subset:
// react-chrono slides in date order, with a chapter card opening each decade.
export function StoryView({
  entries,
  heading,
}: {
  entries: TimelineEntry[];
  heading: string;
}) {
  const items = useMemo(() => {
    const out: ChronoItem[] = [];
    let lastDecade: number | null = null;
    for (const entry of entries) {
      const decade = Math.floor(new Date(entry.startMs).getUTCFullYear() / 10) * 10;
      if (decade !== lastDecade) {
        out.push({ title: `${decade}s`, cardTitle: `The ${decade}s` });
        lastDecade = decade;
      }
      out.push({
        title: entry.dateLabel,
        cardTitle: entry.title,
        cardSubtitle: entry.kind === 'event' ? 'Life event' : entry.mediaType,
        media:
          entry.kind === 'item'
            ? {
                type: 'IMAGE',
                name: `${entry.title}, ${entry.dateLabel}`,
                source: { url: `${API_BASE}/api/items/${entry.id}/thumbnail` },
              }
            : undefined,
      });
    }
    return out;
  }, [entries]);

  if (entries.length === 0) {
    return (
      <p className="timeline-empty">
        No dated items to tell this story with — pick another person or import media.
      </p>
    );
  }

  return (
    <section className="story-view" aria-label={`Story: ${heading}`}>
      <h3>{heading}</h3>
      <Chrono
        items={items}
        mode="VERTICAL_ALTERNATING"
        disableToolbar
        scrollable={{ scrollbar: false }}
        theme={{
          primary: '#6e2431', // --kt-accent (Chrono needs literal values)
          secondary: '#f1e3dc', // --kt-accent-wash
          cardBgColor: '#fffdf8', // --kt-mat
          titleColor: '#5c5346', // --kt-ink-soft
          titleColorActive: '#6e2431',
          cardTitleColor: '#2a241e', // --kt-ink
          glowColor: 'rgba(110, 36, 49, 0.35)', // active-card ring, accent-tinted
          shadowColor: 'rgba(42, 36, 30, 0.18)',
        }}
      />
    </section>
  );
}
