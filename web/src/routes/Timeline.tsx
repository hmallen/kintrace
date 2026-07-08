import { useMemo } from 'react';
import { useItems } from '../api/hooks';
import { TimelineView } from '../components/TimelineView';
import { UndatedTray } from '../components/UndatedTray';
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
          <UndatedTray items={undated} />
        </>
      )}
    </section>
  );
}
