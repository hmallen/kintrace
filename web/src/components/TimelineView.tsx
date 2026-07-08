import { useEffect, useRef } from 'react';
import { Timeline } from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.css';
import type { TimelineDatum } from '../timeline/translate';

// Thin React wrapper owning the vis-timeline lifecycle: create on mount,
// setItems on data change, destroy on unmount. All translation logic lives in
// the pure toTimelineData — this component just hands its output to vis.
export function TimelineView({ data }: { data: TimelineDatum[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<Timeline | null>(null);

  useEffect(() => {
    if (containerRef.current === null) return undefined;
    // vis-timeline needs real layout measurements; jsdom (tests) lacks them,
    // so construction failures are tolerated — the translation unit is the
    // tested surface, and the container stays in the DOM either way.
    try {
      timelineRef.current = new Timeline(containerRef.current, [], {});
    } catch {
      timelineRef.current = null;
    }
    return () => {
      timelineRef.current?.destroy();
      timelineRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      timelineRef.current?.setItems(data);
    } catch {
      // jsdom can't lay the items out; ignore (see above).
    }
  }, [data]);

  return <div ref={containerRef} data-testid="timeline-view" />;
}
