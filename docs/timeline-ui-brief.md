# Goal: Build KinTrace's interactive timeline UI

You are building the browser UI for **KinTrace**, a family-history archive. The backend already exists (Fastify + better-sqlite3, TypeScript, ESM, `tsx`, listens on **port 3271**). Your job is the frontend timeline that makes the archive explorable and beautiful. The UI does not exist yet — you are creating it.

## Decisions (fixed for this task — follow them)
- **Stack:** React + TypeScript + Vite, served as static assets. In dev, Vite proxies `/api/*` to `http://localhost:3271`. Production build must be self-hostable (static files; wiring them into Fastify or a separate static host is fine — keep it simple and documented).
- **Two modes over one REST source**, not one hybrid view:
  1. **Explore** — the dense, virtualized view of the *whole* archive (default).
  2. **Story** — curated, scroll-driven chapters for a chosen subset (a person, a decade). Use **`react-chrono`** here.
- **Fuzzy dates:** consume the existing `[date_start, date_end]` + `date_precision` model as-is. Do **not** add EDTF or change the backend in this task.
- **Explore renderer:** custom **virtualized DOM/SVG** component (windowing — only render viewport-visible items + overscan). Do **not** pull in a Canvas engine yet; design so it could be swapped later if event counts demand it.

## The API contract you build against (already live)
- `GET /api/items?status=&personId=` → array of `{ id, title, media_type, date_start, date_end, date_precision, status, content_hash, thumb_path }`, ordered by date (null dates last). This is your timeline's primary feed.
- `GET /api/items/:id` → full item incl. `description`, `transcription_diplomatic`, `transcription_normalized`, `ai_confidence` (object), `people: [{ id, name, role }]`.
- `GET /api/items/:id/thumbnail` → JPEG (may 404 → show a media-type placeholder).
- `GET /api/items/:id/file` → original media, `Content-Disposition: inline`.
- `GET /api/events` → life/history events `{ id, title, description, date_start, date_end, date_precision, person_id, ... }`.
- `GET /api/people` → `{ id, name, birth_*, death_*, notes }`.
- Dates: `date_start`/`date_end` are ISO `YYYY-MM-DD` (or `null`). `date_precision ∈ exact|month|year|decade|unknown`. An item's date is a *span* from start→end; precision tells you how certain/wide it is (e.g. `year` → the whole year).

## Design requirements (the research this is based on)
1. **Scale toggle — the key lever.** Offer both a **chronological** scale (positions map to real time; honest gaps) and a **sequential** scale (events evenly spaced by order, ignoring gap size). A family archive is lumpy — sequential compresses empty decades and de-clutters dense years. One-click switch.
2. **Orientation toggle** horizontal ↔ vertical from a single control.
3. **Render uncertainty, never hide it.** An item with `precision != exact` must show its **span as a visible range** and encode uncertainty visually (e.g. a softer/gradient fill for wider precision, a "c." / "1940s" label). Items with `null` dates go into a visible "undated" tray, not dropped.
4. **Density handling.** Virtualize the Explore view (render only visible items + overscan). Cluster/collapse dense periods with expand-on-demand. Never render the whole archive at once.
5. **Rich media inline.** Show thumbnails on the timeline; click opens a detail panel with the full file, both transcriptions, confidence, and tagged people. Lazy-load images (intersection observer / `loading="lazy"`).
6. **People & relationships** are first-class: filter the timeline by person (`?personId=`), and surface each item's tagged people. (A TimeNets-style lifeline layout — each person a birth→death line — is a stretch goal, not required now.)
7. **Motion** should be purposeful: smooth zoom/pan and scale/orientation transitions; scroll-driven progression in Story mode. No gratuitous animation.

## Accessibility (non-negotiable, build in from the start)
- **Full keyboard operability** with a **visible focus state that stays readable at high zoom** (WCAG 2.1.1 / 2.4.7).
- **Text alternatives:** alt text per item; a **data-table fallback** of the timeline reachable for screen readers (WCAG 1.1.1). Aim for an overview-then-details structure (summary → drill in), not a flat wall of nodes.
- **No color-alone encoding** — pair color with shape/label/border (WCAG 1.4.1). Media type and certainty must be distinguishable without color.
- If you use inline SVG, make it accessible (`role="img"` + `<title>`/`<desc>` referenced via `aria-labelledby`).

## Responsive
- **Define the mobile layout deliberately** — do not just shrink the desktop view. On small screens collapse to **stacked cards / vertical progressive disclosure**. Must reflow without horizontal scrolling (WCAG 1.4.10).

## Scope & acceptance for THIS deliverable (Explore MVP first)
Ship in this order; each must actually work against a running backend:
1. **Explore view** fetching `GET /api/items`, virtualized, with thumbnails, the **scale toggle**, orientation toggle, and the undated tray. Uncertain dates render as spans.
2. **Detail panel** (`GET /api/items/:id` + `/file`) with transcriptions, confidence, people.
3. **Person filter** driving `?personId=`.
4. **Story mode** with `react-chrono` for a selected subset.
5. Keyboard nav + data-table fallback + responsive/mobile layout throughout — not a later pass.

**Done means:** `npm run dev` (backend on 3271) + the frontend dev server run together; a reviewer can load the timeline, toggle scale/orientation, open an item, filter by person, tab through it with the keyboard, and use it on a narrow viewport. Add a short README section on running and building the UI.

## Constraints / invariants
- **Do not modify the backend or DB schema** in this task. If you find you need a new endpoint, stop and flag it rather than adding one.
- Keep the frontend's code style, naming, and structure consistent with the existing TypeScript/ESM repo.
- Handle empty/`null`/missing thumbnails and empty result sets gracefully.
- Prefer a small, well-factored component set over a heavy framework of abstractions. State the exact dependencies you add and why.

---

## Appendix: research basis

This brief distills a verified deep-research pass (24/25 claims confirmed via 3-vote adversarial checking). Key sources:

- **Timeline design space** — Brehmer et al., *Timelines Revisited* (IEEE TVCG 2017): representation × scale × layout; sequential scale is the lever for uneven density. <https://timelinesrevisited.github.io/>
- **Genealogy lifelines** — Kim/Card/Heer, *TimeNets* (AVI 2010): horizontal time axis, birth→death lifelines, relationships on the vertical axis, saturation gradients for uncertain dates. <https://homes.cs.washington.edu/~jheer/files/genvis.pdf>
- **Fuzzy dates go unused** — most charting systems reject range-bounded periods (arXiv:1905.04611); render uncertainty instead of dropping it. <https://arxiv.org/pdf/1905.04611>
- **Library fit** — `react-chrono` (four layouts, native media, IO lazy-load) for story/media; `TimelineJS3` best kept ≤~20 slides; `vis-timeline` renders smoothly only up to a few hundred visible items. <https://github.com/prabhuignoto/react-chrono>, <https://visjs.github.io/vis-timeline/examples/timeline/other/performance.html>
- **Density mitigation** — pagination/windowing/progressive disclosure. <https://uxpatterns.dev/patterns/data-display/timeline>
- **Screen-reader model** — MIT Vis, *Rich Screen Reader Experiences* (EuroVis 2022): overview-then-details tree + structural/spatial/targeted navigation. <https://vis.csail.mit.edu/pubs/rich-screen-reader-vis-experiences/>
- **WCAG baseline** — keyboard operability, text alternatives, non-color encoding, accessible SVG. <https://www.a11y-collective.com/blog/accessible-charts/>, <https://data.europa.eu/apps/data-visualisation-guide/accessible-svg-and-aria>

**Deferred (future tasks):** EDTF at the API boundary; TimeNets lifeline layout; Canvas renderer if event volume grows past a few hundred visible items.
