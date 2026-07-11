import type { TimelineStoryState } from '@shared/api.js';
import { useMemo } from 'react';
import { Chrono } from 'react-chrono';
import { Link } from 'react-router-dom';
import { API_BASE } from '../api/client';
import type { TimelineEntry } from '../timeline/layout';
import { formatDateLabel } from '../timeline/translate';

interface ChronoItem {
  title?: string;
  cardTitle?: string;
  cardSubtitle?: string;
  media?: { type: 'IMAGE'; name: string; source: { url: string } };
}

export function StoryView({
  entries,
  heading,
  storyState,
  storyLoading = false,
  generating = false,
  generationError,
  onGenerate,
}: {
  entries: TimelineEntry[];
  heading: string;
  storyState?: TimelineStoryState;
  storyLoading?: boolean;
  generating?: boolean;
  generationError?: string;
  onGenerate?: () => void;
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
        media: entry.kind === 'item'
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

  const savedStory = storyState?.story;
  const sourceById = new Map(storyState?.sources.map((source) => [source.itemId, source]));
  const unavailableMessage = storyState?.unavailableReason === 'openai_not_configured'
    ? 'Set OPENAI_API_KEY to enable story generation.'
    : storyState?.unavailableReason === 'no_reviewed_media'
      ? 'Review at least one library item before generating a story.'
      : undefined;

  return (
    <section className="story-view" aria-label={`Story: ${heading}`}>
      <section className="generated-story" aria-label="AI-generated archive story">
        <div className="generated-story-heading">
          <div>
            <h3>Whole-library narrative</h3>
            <p>Generated only from reviewed library media, regardless of the person filter.</p>
          </div>
          {onGenerate && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating || storyLoading || !storyState?.canGenerate}
              title={unavailableMessage}
            >
              {generating ? 'Generating…' : savedStory ? 'Regenerate story' : 'Generate story'}
            </button>
          )}
        </div>
        {storyLoading && <p>Loading saved story…</p>}
        {!storyLoading && unavailableMessage && !savedStory && (
          <p className="generated-story-note">{unavailableMessage}</p>
        )}
        {generationError && <p className="form-error" role="alert">{generationError}</p>}
        {storyState?.stale && savedStory && (
          <p className="generated-story-stale" role="status">
            <strong>Out of date.</strong> Reviewed library media has changed. Regenerate manually to refresh this story.
          </p>
        )}
        {savedStory && (
          <article className="generated-story-article">
            <h4>{savedStory.title}</h4>
            {savedStory.sections.map((section, sectionIndex) => (
              <section key={`${section.heading}-${sectionIndex}`}>
                <h5>{section.heading}</h5>
                {section.paragraphs.map((paragraph, paragraphIndex) => (
                  <div className="generated-story-paragraph" key={paragraphIndex}>
                    <p>{paragraph.text}</p>
                    <ul className="story-sources" aria-label="Supporting library media">
                      {[...new Set(paragraph.sourceItemIds)].map((itemId) => {
                        const source = sourceById.get(itemId);
                        if (!source) return <li key={itemId}>Source item {itemId}</li>;
                        const label = `${source.title} · ${formatDateLabel(source.dateStart, source.datePrecision)}`;
                        return (
                          <li key={itemId}>
                            {source.available
                              ? <Link to={`/items/${itemId}`}>{label}</Link>
                              : <span>{label} (no longer available)</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
            <footer>
              Generated {storyState.generatedAt ?? 'at an unknown time'} from {storyState.storySourceCount} reviewed {storyState.storySourceCount === 1 ? 'item' : 'items'} using {storyState.model ?? 'OpenAI'}.
            </footer>
          </article>
        )}
      </section>

      <h3>{heading}</h3>
      {entries.length === 0 ? (
        <p className="timeline-empty">
          No dated items to tell this story with — pick another person or import media.
        </p>
      ) : (
        <Chrono
          items={items}
          mode="VERTICAL_ALTERNATING"
          disableToolbar
          scrollable={{ scrollbar: false }}
          theme={{
            primary: '#6e2431',
            secondary: '#f1e3dc',
            cardBgColor: '#fffdf8',
            titleColor: '#5c5346',
            titleColorActive: '#fffdf8',
            cardTitleColor: '#2a241e',
            glowColor: 'rgba(110, 36, 49, 0.35)',
            shadowColor: 'rgba(42, 36, 30, 0.18)',
          }}
        />
      )}
    </section>
  );
}
