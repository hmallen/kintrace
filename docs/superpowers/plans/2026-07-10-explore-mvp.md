# Explore MVP (Timeline UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/timeline` route as the brief's Explore MVP — a custom virtualized timeline with scale/orientation toggles, uncertainty rendering, undated tray, person filter, table fallback, and a react-chrono Story mode — replacing the current vis-timeline view.

**Architecture:** A pure layout module maps items/events to axis positions under two scales (chronological/sequential); a windowing hook slices that layout to the visible viewport; a DOM renderer draws cards/spans in either orientation. The route composes renderer + controls + undated tray + table fallback + Story mode. Detail panel = existing Workspace route (`/items/:id`).

**Tech Stack:** React 19 + TS + Vite (existing `web/`), @tanstack/react-query hooks (existing), zod contracts from `shared/api.ts`, vitest + Testing Library + msw (existing). **New dependency: `react-chrono` only** (mandated by the brief for Story mode). **Removed: `vis-timeline`, `vis-data`.**

## Reality check vs. the brief

The brief claims "The UI does not exist yet." It does: `web/` is a working React app (Library, Workspace detail, Import, People, GEDCOM review) whose Timeline route uses vis-timeline. This plan follows the brief's *decisions* (custom virtualized renderer, react-chrono Story mode, toggles, a11y) while integrating into the existing app rather than scaffolding a new one:

- Detail panel requirement is satisfied by navigating to the existing Workspace (`/items/:id`), which already shows file, both transcriptions, confidence, people.
- `useItems({ personId })`, `usePeople`, `useEvents`, `UndatedTray`, and `formatDateLabel` already exist and are reused.
- vis-timeline (`TimelineView.tsx`, `timeline/tooltip.ts`, vis parts of `timeline/translate.ts`) is removed — the brief forbids it in favor of the custom renderer.
- Events stay on the timeline as thumbnail-less milestone markers (removing them would regress the current route).

## Global Constraints

- Do **not** modify the backend or DB schema. New endpoints are out of scope — stop and flag instead.
- Consume `[date_start, date_end]` + `date_precision ∈ exact|month|year|decade|unknown` as-is. No EDTF.
- Explore renderer is custom virtualized DOM/SVG — no Canvas engine, no timeline library for Explore.
- Never render the whole archive at once: window to viewport + overscan; cluster dense periods with expand-on-demand.
- Uncertainty is rendered, never hidden: non-exact precision shows a visible span, softer fill, and a "c." / "1940s"-style label; null dates go to the undated tray.
- A11y non-negotiables: full keyboard operability; visible focus state; data-table fallback; no color-alone encoding (pair with shape/label/border); inline SVG gets `role="img"` + `<title>`/`<desc>` via `aria-labelledby`.
- Responsive: small screens collapse to stacked cards / vertical progressive disclosure; no horizontal body scroll (WCAG 1.4.10).
- Motion purposeful only; honor `prefers-reduced-motion`.
- Match existing repo conventions: pure logic in plain `.ts` modules with unit tests; components tested via Testing Library + msw; design tokens from `web/src/styles/theme.css` ("archivist's desk" system, single oxblood accent, status hues).

---

### Task 1: Pure layout engine (`web/src/timeline/layout.ts`)

**Files:**
- Create: `web/src/timeline/layout.ts`
- Create: `web/src/timeline/layout.test.ts`
- Modify: `web/src/timeline/translate.ts` → shrink to shared formatting (`formatDateLabel`, `escapeHtml` if still needed); vis-specific `toTimelineData`/tooltip wiring is deleted in Task 3.

**Interfaces (Produces):**
```ts
export type Scale = 'chronological' | 'sequential';

export interface TimelineEntry {
  key: string;                 // 'item-3' | 'event-7' (unique across kinds)
  kind: 'item' | 'event';
  id: number;
  title: string;               // fallback 'Untitled'
  dateLabel: string;           // formatDateLabel output, incl. 'c. 1940s'
  startMs: number; endMs: number; // UTC ms; end ≥ start (precision span)
  precision: Precision;
  status?: Status;             // items only
  mediaType?: MediaType;       // items only
}

export function toEntries(items: ItemSummary[], events: EventSummary[]):
  { entries: TimelineEntry[]; undated: ItemSummary[] };
  // sorted by startMs then key; null/unknown-dated items → undated;
  // null/unknown-dated events dropped (as today)

export interface PlacedEntry { entry: TimelineEntry; startPx: number; endPx: number; lane: number; }
export interface AxisTick { px: number; label: string; }   // e.g. '1918', '1920s'
export interface TimelineLayout {
  placed: PlacedEntry[];       // same order as input entries
  ticks: AxisTick[];
  lengthPx: number;            // total scrollable axis length
  laneCount: number;           // cross-axis lanes used
}
export function layoutTimeline(entries: TimelineEntry[], scale: Scale, opts?: {
  pxPerDay?: number;           // chronological density (zoom); default chosen so a decade ≈ 900px
  stepPx?: number;             // sequential spacing per entry; default ~180
  minSpanPx?: number;          // floor so exact points remain visible/clickable
}): TimelineLayout;

export interface Cluster { key: string; startPx: number; endPx: number; members: PlacedEntry[]; }
export type TimelineNode = { type: 'entry'; placed: PlacedEntry } | { type: 'cluster'; cluster: Cluster };
export function clusterLayout(layout: TimelineLayout, opts?: { thresholdPx?: number; minSize?: number }): TimelineNode[];
  // entries whose px-extents crowd within thresholdPx collapse into a Cluster
  // once ≥ minSize (default 4); expansion is UI state, not layout state
```

**Behavior contracts (each is a unit test):**
- Chronological: px position is linear in time; a 4-year archive with an empty middle decade keeps the gap (honest gaps).
- Sequential: entries evenly spaced by sort order regardless of gap size; span still drawn (endPx > startPx for non-exact) but bounded so ordering reads clearly.
- Precision spans: `year` item covers Jan 1–Dec 31 extent; `exact` gets `minSpanPx`.
- Lane assignment: overlapping px-extents get different lanes (greedy, first-fit); non-overlapping reuse lane 0.
- Ticks: chronological → year ticks (decade ticks when range > ~40y); sequential → tick at each year boundary present in the data.
- Clustering: N co-located entries → one cluster node with all members; sparse data yields no clusters.
- `toEntries` routes null-start/unknown items to `undated` and keeps event ids namespaced (`event-<id>`).

- [x] Write failing unit tests for the contracts above (synthetic fixtures incl. a 1,000-entry set for lane/cluster perf sanity)
- [x] Implement `layout.ts` until green
- [x] `npm run test` + `npm run typecheck` in `web/`
- [x] Commit

### Task 2: Virtualized Explore renderer

**Files:**
- Create: `web/src/timeline/useVirtualWindow.ts` (+ `useVirtualWindow.test.ts`)
- Create: `web/src/components/ExploreTimeline.tsx` (+ `ExploreTimeline.test.tsx`)
- Modify: `web/src/timeline/timeline.css` (rewrite for the new renderer)

**Interfaces:**
- Consumes: `TimelineLayout`, `TimelineNode[]`, `clusterLayout` from Task 1; `Thumbnail`/`MediaTypeIcon` components.
- Produces:
```ts
export type Orientation = 'horizontal' | 'vertical';
export function useVirtualWindow(opts: {
  containerRef: RefObject<HTMLElement>; orientation: Orientation;
  lengthPx: number; overscanPx?: number;              // default ~600
}): { startPx: number; endPx: number };               // visible px window

export function ExploreTimeline(props: {
  nodes: TimelineNode[]; layout: TimelineLayout;
  scale: Scale; orientation: Orientation;
  onOpenItem: (id: number) => void;
}): JSX.Element;
```

**Behavior contracts:**
- Only nodes intersecting the window ± overscan are in the DOM (test: 1,000 entries → rendered card count « 1,000; scrolling changes which ids render).
- Cards: item cards show lazy thumbnail (`loading="lazy"`, 404 → `MediaTypeIcon` placeholder), title, `dateLabel`, status chip; event nodes render as labeled milestone markers (distinct shape, no thumbnail).
- Uncertainty: non-exact nodes draw a span bar the full px extent, softer/gradient fill by precision width, label carries "c." form; encoding readable without color (border/shape/label per precision + media-type icon).
- Clusters render as an expandable button ("1923 · 5 items") — expanding swaps members into the flow; Escape/toggle collapses.
- Orientation prop flips main axis (horizontal scroll ↔ vertical scroll) without remount; positions come from the same layout.
- Keyboard: timeline is `role="list"` of focusable cards; ArrowLeft/Right (or Up/Down when vertical) move focus between visible nodes, Home/End jump, Enter/Space opens item (`onOpenItem`) or toggles cluster; focus ring uses theme accent, stays visible at zoom.
- Scale/orientation changes animate via CSS transform transitions; disabled under `prefers-reduced-motion`.

- [x] Load `frontend-design` + `dataviz` skills before styling; write failing component tests (windowing, placeholder fallback, keyboard nav, cluster expand)
- [x] Implement hook + component + css until green
- [x] Commit

### Task 3: Rebuild the Timeline route (controls, filter, table, tray); remove vis-timeline

**Files:**
- Modify: `web/src/routes/Timeline.tsx` (rebuild), `web/src/routes/Timeline.test.tsx`
- Create: `web/src/components/TimelineControls.tsx`, `web/src/components/TimelineTable.tsx` (+ tests)
- Delete: `web/src/components/TimelineView.tsx`, `web/src/timeline/tooltip.ts`, `web/src/timeline/tooltip.test.ts`; vis parts of `translate.ts` (+ its test) fold into `layout.ts`/`format` usage
- Modify: `web/package.json` (drop `vis-timeline`, `vis-data`)

**Interfaces:**
- Consumes: Task 1/2 exports; `useItems({ personId })`, `useEvents`, `usePeople`, `UndatedTray`.
- Produces: route state contract — `view ∈ explore|story|table`, `scale`, `orientation`, `personId` held in URL search params (`useSearchParams`) so views are shareable/back-button friendly; `personId` flows into `useItems` → API `?personId=`.

**Behavior contracts:**
- Controls bar: scale toggle (Chronological/Sequential), orientation toggle (Horizontal/Vertical), view switcher (Explore/Story/Table), person `<select>` from `usePeople` ("All people" default). All real buttons/selects with labels; toggle state exposed via `aria-pressed`/checked semantics.
- Person filter changes refetch items with `personId` and update the URL; empty result set renders a friendly empty state (not a crash).
- Table view: real `<table>` with caption + `<th scope>`, one row per dated item/event (date label, title, kind/media type, status, link to detail), undated items included with "Undated"; serves as the WCAG 1.1.1 fallback and is a first-class view anyone can toggle.
- Undated tray stays visible beneath Explore (reuses `UndatedTray`).
- Route test proves: toggling scale re-lays-out (axis length changes), person select hits `/api/items?personId=`, table view lists undated items, card click navigates to `/items/:id`.
- `data-item-count`-style test hooks are gone; tests assert real DOM.

- [x] Write failing route/component tests (msw fixtures incl. people + mixed precisions)
- [x] Rebuild route + controls + table; delete vis files; `npm uninstall vis-timeline vis-data`
- [x] Full `npm run test` + `npm run typecheck` in `web/` (fix fallout from deletions)
- [x] Commit

### Task 4: Story mode (react-chrono)

**Files:**
- Create: `web/src/components/StoryView.tsx` (+ `StoryView.test.tsx`)
- Modify: `web/src/routes/Timeline.tsx` (mount under `view=story`), `web/package.json` (add `react-chrono`)

**Interfaces:**
- Consumes: `TimelineEntry[]` (dated, already person-filtered) + person name for the heading.
- Produces: `StoryView(props: { entries: TimelineEntry[]; heading: string })` rendering react-chrono `VERTICAL_ALTERNATING` (falls back to `VERTICAL` on narrow viewports), scroll-driven, slides carry title, dateLabel, and item thumbnails via chrono's media support (`/api/items/:id/thumbnail`).

**Behavior contracts:**
- Chapters group by decade: a decade heading card precedes its items (curated feel per brief).
- Works with the person filter: selecting a person + Story shows only their items; empty subset → prompt to pick a person/loosen filter.
- Test: given fixture entries, renders chrono cards in date order with decade chapters; empty entries → empty-state message (chrono not mounted).

- [x] `npm install react-chrono` (web/); failing tests; implement until green
- [x] Commit

### Task 5: Responsive + a11y pass, README, end-to-end verification

**Files:**
- Modify: `web/src/timeline/timeline.css`, `web/src/styles/global.css` (only if shared rules needed)
- Modify: `README.md` (running/building the UI section)

**Behavior contracts:**
- ≤ 640px: Explore forces vertical orientation with stacked cards (orientation toggle hidden/disabled with explanation), controls wrap, no horizontal body scroll at 320px width.
- Focus visible on every interactive element (cards, toggles, tray chips, table links) at 200% zoom; all SVG decorative-or-labeled per constraint.
- README documents: run backend (`npm run dev`, port 3271) + `cd web && npm run dev` (proxy), `npm run build` output + note on static hosting.
- Verification against the live backend (use the `verify` skill / browser): load timeline, toggle scale + orientation, expand a cluster, open an item detail, create a person + tag an item via API, filter by that person, switch to Story and Table views, tab through with keyboard, check 375px viewport.

- [x] CSS/a11y pass with tests where assertable (e.g. table caption, aria-pressed)
- [x] README section
- [x] `npm run test` + `npm run typecheck` in BOTH root and `web/`
- [x] Manual end-to-end run per above; fix anything found
- [x] Commit

## Self-review notes

- Brief §Scope 1–5 → Tasks 2/3 (Explore+toggles+tray), existing Workspace + card click (detail), Task 3 (person filter), Task 4 (Story), Tasks 2/3/5 (keyboard/table/responsive, built in per task not deferred — Task 5 is the sweep, not the introduction).
- Zoom/pan (brief §Design 7 "smooth zoom/pan"): chronological `pxPerDay` is the zoom seam; MVP ships fixed default + smooth scale/orientation transitions — full zoom UI is not in the brief's acceptance list, noted as future.
- No backend changes anywhere; only dependency delta: +react-chrono, −vis-timeline, −vis-data.
