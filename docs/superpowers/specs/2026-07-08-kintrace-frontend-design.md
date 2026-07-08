# KinTrace Frontend — Design Spec

Date: 2026-07-08
Status: approved (brainstormed and section-approved in session)
Source prompt: `docs/2026-07-07-kintrace-frontend-build-prompt.md`

## Goal

A React web client for KinTrace that consumes the existing Fastify backend
(`http://127.0.0.1:3271`): browse imported archival items, review/correct
AI-generated transcriptions and metadata (foregrounding the two-pass HTR
confidence data), drive items through `pending → transcribed → reviewed`, and
render everything on an interactive fuzzy-date timeline. Local single-user
today; architecture stays cloud-portable (no auth machinery now).

Scope: **full v1 in one plan** — walking skeleton first, then review editor,
timeline, import/upload, queue UI, and people management. Each stage
independently shippable.

## Model roles (build process)

- Controller session (brainstorm/design/orchestration): Fable 5.
- Plan drafting and all code reviews: dispatched to **Opus 4.8** subagents.
- Every implementer (code-writing) subagent: **`model: claude-fable-5`**,
  overriding subagent-driven-development's cheapest-capable default.
- Final whole-branch review: most capable model available (Opus 4.8).

## Stack (adopted from the research-backed default; no deviations)

- **Vite + React + TypeScript SPA** in `web/` (strict, ESM). React Router v7
  in plain SPA mode (upgrade path if a hosted/SSR future arrives).
- **TanStack Query** owns all REST data (caching, invalidation, optimistic
  updates, polling). **Zustand** for UI-only state — never duplicates server
  data. List filters live in the URL, not a store.
- **React Hook Form + zod** for forms; every API response is zod-parsed.
- **vis-timeline** (alone — no react-chrono; it is display-only, cannot do
  date ranges, and our own detail views cover media-rich storytelling) for
  the interactive axis, wrapped in a React component with custom uncertainty
  CSS.
- **CodeMirror 6** for the transcription review editor (plain-text-first,
  preserves line breaks, decorations API for span highlights).
- **Uppy 5** (Dashboard/React) for the upload UI, posting to the new
  multipart endpoint.
- **MSW** for HTTP-layer test fakes; **vitest + React Testing Library** for
  tests. All open-source (constraint 2).

## Repo layout & shared contract

- New top-level **`web/`** (own `package.json`); backend untouched in place.
- New top-level **`shared/`** — a plain TS directory, not an npm package;
  both sides import it (backend by relative path, web via an `@shared` Vite
  alias + `server.fs.allow`). No npm workspaces.
- **`shared/api.ts`** — zod schemas for every wire shape: `ItemSummary`,
  `ItemDetail` (nullable `transcription_diplomatic`/`transcription_normalized`,
  parsed `ai_confidence` object, `ai_names` JSON string, `ai_error`,
  `people`), `AiConfidence` (`{ overall: 'high'|'medium'|'low', summary,
  flaggedSpans: [{ text, reason }] } | null`), `Person`, `ImportResult`,
  `QueueResult`, `PatchItemBody`, and enums `MediaType`, `Precision`,
  `Status`, `PersonRole`. The frontend `parse()`s every response with these;
  backend route handlers are type-checked against them (`satisfies`).
  `ConfidenceSchema` moves here from `src/ai/transcriber.ts` (re-exported
  there so existing imports/tests keep working).
- **`shared/dates.ts`** — the pure `normalizeFuzzyDate` + `FuzzyDate` +
  `Precision` move here; `src/dates.ts` becomes a re-export. The web date
  editor uses it to preview exactly what the server will store.

Rationale: the API response shapes are not zod-defined anywhere today
(routes return raw DB rows), so "reuse the backend's schemas" is honored by
extracting one shared contract both sides are pinned to; drift becomes a
compile (or parse) error.

## Backend additions (TDD, zod-validated, existing test style)

1. **`GET /api/items/:id/thumbnail`** — streams the thumbnail JPEG; 404 if
   the item or its thumb is missing.
2. **`GET /api/items/:id/file`** — streams the archived original;
   content-type inferred from extension; inline disposition. Image viewer,
   audio/video players, and the PDF iframe all point here.
3. **`POST /api/upload`** — `@fastify/multipart` (MIT): file parts + a
   `mediaType` field; stages each file under `data/staging/`, runs the
   existing `importFile`, removes the staged copy, returns the same per-file
   array as `/api/import` (`{ path: <original filename>, itemId, duplicate }`
   or `{ path, error }`). `/api/import` itself is unchanged (still useful for
   server-side batch imports).

No CORS work: the Vite dev server proxies `/api` → `127.0.0.1:3271`. The
client base URL is `import.meta.env.VITE_API_BASE ?? ''` — the single knob a
hosted future needs.

## Data layer (`web/src/api/`)

- `apiFetch(path, schema, init?)` — fetch wrapper that throws a typed
  `ApiError` (status + server `error` message) on non-2xx and zod-parses
  every body, so bad responses surface through Query error state.
- Query hooks: `useItems(filters)`, `useItem(id)`, `usePeople()`; mutation
  hooks for patch-item (save + approve), link-person, create-person, upload,
  process-queue. Query keys `['items', filters]`, `['item', id]`,
  `['people']`; mutations invalidate what they touch.
- Queue processing: `useMutation` on `POST /api/queue/process`; while the
  mutation is in flight, items queries poll with a 2s function-form
  `refetchInterval` so statuses tick over live, and stop when it settles.
  503 → persistent "AI not configured" state (button disabled + explanation
  naming the missing env var).

## Screens

- **`/` Library** — thumbnail grid; status chips, media-type icons, date
  labels; status/person filters from URL params. Header actions: Import,
  Process queue (spinner + live ticking while processing).
- **`/items/:id` Review workspace** — two panes (stacked on narrow screens):
  media viewer left (image zoom/pan; `<audio>`/`<video>`; PDF iframe),
  review panel right. Details below.
- **`/timeline`** — vis-timeline axis + "Undated" tray.
- **`/import`** — Uppy Dashboard + media-type selector; per-file results.
- **`/people`** — list + create; clicking a person routes to `/?personId=`.

## Review workspace

- **Confidence banner**: overall badge (high/medium/low), AI `summary`,
  `ai_error` when present.
- **Transcription editor**: CodeMirror 6; diplomatic ↔ normalized tab toggle
  (diplomatic default — flagged spans quote it). Decorations highlight
  (a) each flagged span by substring match — all occurrences — tooltip =
  `reason`;
  (b) uncertainty markers `[illegible]` / `[?]` / `[possibly …]` via regex,
  styled distinctly. **Flags sidebar** lists `flaggedSpans` with reasons;
  click scrolls/selects in the editor; spans no longer present in the edited
  text render struck-through ("resolved"). Null transcription → "no text
  detected" empty state with a "start transcription" action.
- **Metadata form** (RHF + zod): title, description, **fuzzy date editor** —
  date input + precision select with a live preview computed by the shared
  `normalizeFuzzyDate` ("1943 + year → Jan 1 – Dec 31, 1943"); `unknown`
  disables the date input.
- **People**: role-grouped chips of current links; add-link picker (existing
  person + role) with inline create-person. `ai_names` (parsed JSON) render
  as suggestion chips — one click creates the person and links as `subject`.
- **Lifecycle**: Save (PATCHes only changed fields, optimistic) is separate
  from **Mark reviewed**; approve is disabled on `pending` items with the
  reason shown, and a raced 409 still surfaces cleanly. Status chip always
  visible. `ai_confidence` is display-only (not PATCHable).

## Timeline & uncertainty encoding

One library (vis-timeline); CSS class per precision:

- `exact` → point marker.
- `month` / `year` → range bar, solid center, **gradient-faded edges**.
- `decade` → **diagonal-hatched translucent bar**.
- Labels stay textually honest: "May 12, 1943", "May 1943", "1943",
  "c. 1940s".
- `unknown` → never faked onto the axis; a persistent **"Undated" tray**
  below the timeline keeps those items visible and clickable.
- Hover tooltip: title, thumbnail, precision + full range. Click → review
  workspace. Items tint by status so unreviewed work is spottable.

Rationale: fade encodes continuous edge-uncertainty, hatch encodes
categorical coarseness, text labels remain ground truth — three redundant
channels, no misleading precision.

## Import & duplicate feedback

Backend dedupes by content hash after upload, so the UX is **inform, don't
ask** (no skip/replace/keep-both — identical bytes, nothing to replace).
Results list per file: imported (link to new item), "already in archive"
(distinct badge + link to the existing item), or failed (error text,
non-blocking). Summary line: "7 imported, 2 already in archive, 1 failed".

## Design language

**"The archivist's desk"** — warm paper/ivory surfaces, ink-charcoal text,
one accent (deep oxblood/sepia); **Fraunces** (OFL) as the serif display
face for titles over a quiet grotesque for UI; scans presented like prints on a
desk (subtle shadow, generous margins); restrained texture, no skeuomorphic
kitsch; modern grid and fast interactions underneath. Executed with the
frontend-design skill during implementation. Dark mode deferred (YAGNI).

## Error handling

- Every response zod-parsed; parse failure or non-2xx → typed `ApiError` in
  Query/mutation error state — never a silently-wrong render.
- Route-level error boundaries with retry; per-mutation inline errors next
  to their control (409 approve → "item hasn't been transcribed yet"; 503
  queue → "AI not configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY";
  upload failures stay per-file in the results list).
- Fetch rejection (backend down) → full-page "can't reach the KinTrace
  backend on :3271" state with retry.

## Testing

- **MSW** at the network boundary: components exercise their real
  fetch/Query/zod pipeline against realistic handlers; no test hits a real
  backend or network (constraint 5).
- Unit: fuzzy-date → timeline-item translation (every precision incl.
  unknown-tray routing), flagged-span → decoration matching (incl. resolved
  behavior after edits), `apiFetch` zod gating, date preview.
- Component (RTL/JSDOM): review flow (edit → save PATCHes only changed
  fields → approve flips status), 409 and 503 paths, import results incl.
  duplicates, library filtering.
- Backend additions get backend-style vitest tests alongside the existing
  suite.
- Definition of done per slice additionally requires driving the real flows
  in a real browser against the live backend (verify/run skills).

## Staging (walking skeleton first — constraint 4)

- **Stage 0 — contract + media plumbing**: `shared/` extraction; backend
  `GET .../thumbnail` + `GET .../file` (the skeleton needs to show the scan;
  a reviewer can't correct a transcription blind). Upload endpoint may land
  in Stage 4.
- **Stage 1 — walking skeleton** (against the live backend, end to end):
  app shell + library list → item workspace with image viewer,
  plain-textarea editing of both transcriptions, flagged-spans list
  (surfaced, not yet inline-highlighted), title/description/date+precision
  editing, person linking, approve to `reviewed`; minimal timeline rendering
  that item's fuzzy date correctly.
- **Stage 2 — review editor**: CodeMirror with inline flagged-span/marker
  highlighting + flags sidebar.
- **Stage 3 — full timeline**: all precision styles, undated tray, status
  tints, tooltips, navigation.
- **Stage 4 — ingest**: `POST /api/upload`, Uppy import screen, duplicate
  feedback, queue processing UI with live polling.
- **Stage 5 — completeness & polish**: people screen, `ai_names` suggestion
  chips, audio/video/pdf viewers, visual polish pass (frontend-design).

Every stage: typecheck clean, tests green, committed per green cycle; the
skeleton is verified in-browser against the real backend before Stage 2.

## Out of scope (v1)

Auth/multi-tenancy, hosted deployment, dark mode, editing `people`
birth/death dates (backend `POST /api/people` only takes `name`/`notes`),
unlinking people from items and deleting items (no backend endpoints — noted
as possible future backend work), `events` table UI, multi-page (`pages`
table) viewing beyond the primary file.
