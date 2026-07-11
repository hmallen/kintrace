import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type {
  PlacedEntry,
  Scale,
  TimelineLayout,
  TimelineNode,
} from '../timeline/layout';
import { useVirtualWindow, type Orientation } from '../timeline/useVirtualWindow';
import { MediaTypeIcon } from './MediaTypeIcon';
import { StatusChip } from './StatusChip';
import { Thumbnail } from './Thumbnail';
import '../timeline/timeline.css';

// Cross-axis geometry. Cards hang off their anchor by up to this much along
// the main axis, so windowing keeps a node alive until its whole card is out.
const NODE_OVERHANG_PX = 240;
const AXIS_PX = 44; // rail + tick labels
// Card height is deterministic (thumb 84 + two clamped title lines + date +
// meta + padding ≈ 196px), so lanes can pack without overlap.
const LANE_MAIN_PX = { horizontal: 212, vertical: 236 } as const;
const CANVAS_PAD_PX = 260; // trailing room so the last card is never clipped

function nodeStart(node: TimelineNode): number {
  return node.type === 'entry' ? node.placed.startPx : node.cluster.startPx;
}

function nodeEnd(node: TimelineNode): number {
  return node.type === 'entry' ? node.placed.endPx : node.cluster.endPx;
}

function nodeKey(node: TimelineNode): string {
  return node.type === 'entry' ? node.placed.entry.key : node.cluster.key;
}

function yearOf(ms: number): number {
  return new Date(ms).getUTCFullYear();
}

function clusterLabel(members: PlacedEntry[]): string {
  const first = yearOf(members[0]!.entry.startMs);
  const last = yearOf(members[members.length - 1]!.entry.startMs);
  const years = first === last ? String(first) : `${first}–${last}`;
  return `${years} · ${members.length} items`;
}

function mainAxisStyle(orientation: Orientation, startPx: number, lane: number): CSSProperties {
  const cross = AXIS_PX + lane * LANE_MAIN_PX[orientation];
  return orientation === 'horizontal'
    ? { left: startPx, top: cross }
    : { top: startPx, left: cross };
}

export function ExploreTimeline({
  nodes,
  layout,
  scale,
  orientation,
  onOpenItem,
}: {
  nodes: TimelineNode[];
  layout: TimelineLayout;
  scale: Scale;
  orientation: Orientation;
  onOpenItem: (id: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [expandedClusters, setExpandedClusters] = useState<ReadonlySet<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const lengthPx = layout.lengthPx + CANVAS_PAD_PX;
  const win = useVirtualWindow({ containerRef: scrollRef, orientation, lengthPx });

  const visible = useMemo(() => {
    const out: TimelineNode[] = [];
    for (const node of nodes) {
      if (nodeEnd(node) + NODE_OVERHANG_PX < win.startPx || nodeStart(node) > win.endPx) continue;
      if (node.type === 'cluster' && expandedClusters.has(node.cluster.key)) {
        // Expanded cluster: its members join the flow at their own positions;
        // the cluster chip stays so the run can be collapsed again.
        out.push(node);
        for (const member of node.cluster.members) out.push({ type: 'entry', placed: member });
      } else {
        out.push(node);
      }
    }
    return out;
  }, [nodes, win, expandedClusters]);

  // Roving tabindex: exactly one card is in the tab order; arrows move focus.
  const firstFocusableKey = useMemo(() => {
    for (const node of visible) {
      if (node.type === 'cluster' || node.placed.entry.kind === 'item') return nodeKey(node);
    }
    return null;
  }, [visible]);
  const activeKey = focusKey ?? firstFocusableKey;

  function toggleCluster(key: string) {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLOListElement>) {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !back && event.key !== 'Home' && event.key !== 'End') return;
    const focusables = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('.explore-focusable') ?? [],
    );
    if (focusables.length === 0) return;
    const current = focusables.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = focusables.length - 1;
    else if (forward) next = Math.min(focusables.length - 1, current + 1);
    else next = Math.max(0, current - 1);
    if (next !== current) {
      event.preventDefault();
      focusables[next]?.focus();
    }
  }

  const canvasStyle: CSSProperties =
    orientation === 'horizontal'
      ? { width: lengthPx, height: AXIS_PX + Math.max(1, layout.laneCount) * LANE_MAIN_PX.horizontal }
      : { height: lengthPx, width: AXIS_PX + Math.max(1, layout.laneCount) * LANE_MAIN_PX.vertical };

  return (
    <div
      ref={scrollRef}
      className={`explore-scroller explore-${orientation} explore-scale-${scale}`}
      data-testid="explore-scroller"
    >
      <div className="explore-canvas" style={canvasStyle}>
        {/* Ticks restate dates every card already carries — decorative for AT. */}
        <div className="explore-axis" aria-hidden="true">
          {layout.ticks.map((tick) => (
            <span
              key={tick.px}
              className="explore-tick"
              style={orientation === 'horizontal' ? { left: tick.px } : { top: tick.px }}
            >
              {tick.label}
            </span>
          ))}
        </div>
        <ol
          ref={listRef}
          className="explore-items"
          aria-label="Timeline"
          onKeyDown={handleKeyDown}
        >
          {visible.map((node) => {
            if (node.type === 'cluster') {
              const { cluster } = node;
              const expanded = expandedClusters.has(cluster.key);
              return (
                <li
                  key={cluster.key}
                  className="explore-node explore-cluster"
                  style={mainAxisStyle(orientation, cluster.startPx, 0)}
                >
                  <button
                    type="button"
                    className="explore-cluster-chip explore-focusable"
                    aria-expanded={expanded}
                    tabIndex={activeKey === cluster.key ? 0 : -1}
                    onFocus={() => setFocusKey(cluster.key)}
                    onClick={() => toggleCluster(cluster.key)}
                  >
                    {clusterLabel(cluster.members)}
                  </button>
                </li>
              );
            }

            const { entry, startPx, endPx, lane } = node.placed;
            const extentPx = endPx - startPx;
            const spanStyle: CSSProperties =
              orientation === 'horizontal' ? { width: extentPx } : { height: extentPx };
            const classes = [
              'explore-node',
              `precision-${entry.precision}`,
              entry.kind === 'event' ? 'explore-event' : `status-${entry.status ?? 'pending'}`,
            ].join(' ');

            if (entry.kind === 'event') {
              return (
                <li key={entry.key} className={classes} style={mainAxisStyle(orientation, startPx, lane)}>
                  <span className="explore-span" style={spanStyle} aria-hidden="true" />
                  <span className="explore-milestone">
                    <span className="explore-milestone-marker" aria-hidden="true" />
                    <span className="explore-milestone-title">{entry.title}</span>
                    <span className="explore-node-date">{entry.dateLabel}</span>
                  </span>
                </li>
              );
            }

            return (
              <li key={entry.key} className={classes} style={mainAxisStyle(orientation, startPx, lane)}>
                <span className="explore-span" style={spanStyle} aria-hidden="true" />
                <button
                  type="button"
                  className="explore-card explore-focusable"
                  title={entry.title}
                  tabIndex={activeKey === entry.key ? 0 : -1}
                  onFocus={() => setFocusKey(entry.key)}
                  onClick={() => onOpenItem(entry.id)}
                >
                  <Thumbnail
                    itemId={entry.id}
                    alt={`${entry.title}, ${entry.dateLabel}`}
                    mediaType={entry.mediaType ?? 'photo'}
                    loading="lazy"
                  />
                  <span className="explore-card-title">{entry.title}</span>
                  <span className="explore-node-date">{entry.dateLabel}</span>
                  <span className="explore-card-meta">
                    <MediaTypeIcon type={entry.mediaType ?? 'photo'} />
                    <StatusChip status={entry.status ?? 'pending'} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
