import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEvents, useItems, usePeople } from '../api/hooks';
import { ExploreTimeline } from '../components/ExploreTimeline';
import { StoryView } from '../components/StoryView';
import { TimelineControls, type TimelineViewMode } from '../components/TimelineControls';
import { TimelineTable } from '../components/TimelineTable';
import { UndatedTray } from '../components/UndatedTray';
import { clusterLayout, layoutTimeline, toEntries, type Scale } from '../timeline/layout';
import { useMediaQuery } from '../timeline/useMediaQuery';
import type { Orientation } from '../timeline/useVirtualWindow';

const VIEWS: TimelineViewMode[] = ['explore', 'story', 'table'];

// View state lives in the URL so a filtered, re-scaled timeline is shareable
// and the back button walks through view changes.
function readParams(params: URLSearchParams): {
  view: TimelineViewMode;
  scale: Scale;
  orientation: Orientation;
  personId: number | undefined;
} {
  const rawView = params.get('view');
  const rawPerson = Number(params.get('personId'));
  return {
    view: VIEWS.includes(rawView as TimelineViewMode) ? (rawView as TimelineViewMode) : 'explore',
    scale: params.get('scale') === 'sequential' ? 'sequential' : 'chronological',
    orientation: params.get('orientation') === 'vertical' ? 'vertical' : 'horizontal',
    personId: Number.isSafeInteger(rawPerson) && rawPerson > 0 ? rawPerson : undefined,
  };
}

export function Timeline() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { view, scale, orientation, personId } = readParams(searchParams);
  // Deliberate mobile layout: stacked vertical cards, not a shrunken axis.
  const isNarrow = useMediaQuery('(max-width: 640px)');
  const effectiveOrientation: Orientation = isNarrow ? 'vertical' : orientation;

  const { data: items, isPending } = useItems(personId === undefined ? {} : { personId });
  const { data: events, isPending: eventsPending } = useEvents();
  const { data: people } = usePeople();

  // The person filter scopes events too — the API only filters items.
  const visibleEvents = useMemo(() => {
    const all = events ?? [];
    return personId === undefined ? all : all.filter((e) => e.person_id === personId);
  }, [events, personId]);
  const { entries, undated } = useMemo(
    () => toEntries(items ?? [], visibleEvents),
    [items, visibleEvents],
  );
  const layout = useMemo(() => layoutTimeline(entries, scale), [entries, scale]);
  const nodes = useMemo(() => clusterLayout(layout), [layout]);

  function setParam(key: string, value: string | undefined) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === undefined) next.delete(key);
      else next.set(key, value);
      return next;
    });
  }

  const loading = isPending || eventsPending;
  const empty = !loading && entries.length === 0 && undated.length === 0;

  return (
    <section className="timeline-page">
      <h2>Timeline</h2>
      <TimelineControls
        view={view}
        scale={scale}
        orientation={effectiveOrientation}
        orientationLocked={isNarrow}
        people={people ?? []}
        personId={personId}
        onViewChange={(v) => setParam('view', v === 'explore' ? undefined : v)}
        onScaleChange={(s) => setParam('scale', s === 'chronological' ? undefined : s)}
        onOrientationChange={(o) => setParam('orientation', o === 'horizontal' ? undefined : o)}
        onPersonChange={(id) => setParam('personId', id === undefined ? undefined : String(id))}
      />
      {loading && <p>Loading items…</p>}
      {empty && (
        <p className="timeline-empty">
          {personId === undefined
            ? 'Nothing on the timeline yet — import media to begin.'
            : 'No items are tagged with this person yet.'}
        </p>
      )}
      {!loading && !empty && view === 'explore' && (
        <>
          <ExploreTimeline
            nodes={nodes}
            layout={layout}
            scale={scale}
            orientation={effectiveOrientation}
            onOpenItem={(id) => navigate(`/items/${id}`)}
          />
          <UndatedTray items={undated} />
        </>
      )}
      {!loading && !empty && view === 'table' && (
        <TimelineTable entries={entries} undated={undated} />
      )}
      {!loading && !empty && view === 'story' && (
        <StoryView
          entries={entries}
          heading={
            personId === undefined
              ? 'The whole archive'
              : `${people?.find((p) => p.id === personId)?.name ?? 'One person'}’s story`
          }
        />
      )}
    </section>
  );
}
