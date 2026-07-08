import { useEffect, useRef } from 'react';
import { Timeline } from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.css';
import '../timeline/timeline.css';
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
      if (data.length > 0) {
        timelineRef.current?.fit({ animation: false });
      }
    } catch {
      // jsdom can't lay the items out; ignore (see above).
    }
  }, [data]);

  // data-item-count is a test hook: jsdom can't lay out vis-timeline's DOM,
  // so tests assert what the axis received at the toTimelineData boundary.
  return <div ref={containerRef} data-testid="timeline-view" data-item-count={data.length} />;
}
