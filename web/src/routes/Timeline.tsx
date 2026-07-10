import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEvents, useItems } from '../api/hooks';
import { TimelineView } from '../components/TimelineView';
import { UndatedTray } from '../components/UndatedTray';
import { toTimelineData } from '../timeline/translate';

export function Timeline() {
  const navigate = useNavigate();
  const { data: items, isPending } = useItems({});
  const { data: events, isPending: eventsPending } = useEvents();
  const { data, undated } = useMemo(() => toTimelineData(items ?? [], events ?? []), [events, items]);

  return (
    <section>
      <h2>Timeline</h2>
      {(isPending || eventsPending) && <p>Loading items…</p>}
      {items && events && (
        <>
          <TimelineView
            data={data}
            onSelectItem={(id) => {
              if (typeof id === 'number') navigate(`/items/${id}`);
              if (typeof id === 'string' && /^\d+$/.test(id)) navigate(`/items/${id}`);
            }}
          />
          <UndatedTray items={undated} />
        </>
      )}
    </section>
  );
}
