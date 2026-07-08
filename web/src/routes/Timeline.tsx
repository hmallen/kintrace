import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useItems } from '../api/hooks';
import { TimelineView } from '../components/TimelineView';
import { UndatedTray } from '../components/UndatedTray';
import { toTimelineData } from '../timeline/translate';

export function Timeline() {
  const navigate = useNavigate();
  const { data: items, isPending, isError, error } = useItems({});
  const { data, undated } = useMemo(() => toTimelineData(items ?? []), [items]);

  return (
    <section>
      <h2>Timeline</h2>
      {isPending && <p>Loading items…</p>}
      {isError && <p role="alert">Failed to load items: {error.message}</p>}
      {items && (
        <>
          <TimelineView data={data} onSelectItem={(id) => navigate(`/items/${id}`)} />
          <UndatedTray items={undated} />
        </>
      )}
    </section>
  );
}
