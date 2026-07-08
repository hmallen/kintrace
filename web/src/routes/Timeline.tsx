import { useMemo } from 'react';
import { useItems } from '../api/hooks';
import { TimelineView } from '../components/TimelineView';
import { toTimelineData } from '../timeline/translate';

export function Timeline() {
  const { data: items, isPending, isError, error } = useItems({});
  const { data, undated } = useMemo(() => toTimelineData(items ?? []), [items]);

  return (
    <section>
      <h2>Timeline</h2>
      {isPending && <p>Loading items…</p>}
      {isError && <p role="alert">Failed to load items: {error.message}</p>}
      {items && (
        <>
          <TimelineView data={data} />
          {/* Minimal note for now — the undated tray itself lands in Stage 3. */}
          <p>
            {undated.length} undated {undated.length === 1 ? 'item' : 'items'}
          </p>
        </>
      )}
    </section>
  );
}
