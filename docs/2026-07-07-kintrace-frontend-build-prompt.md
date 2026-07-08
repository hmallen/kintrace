# Prompt: Build the KinTrace React frontend

> Paste everything below the line into a fresh Claude Code (Fable 5) session opened at the KinTrace repo root. It is written to be acted on directly.

---

You are building the **frontend for KinTrace**, an app that turns family photos, letters, articles, and other archival media into an interactive family-history timeline. The backend already exists; your job is the React web client that consumes it. You own the complex development decisions — framework wiring, component architecture, visual design, how to represent uncertain dates — within the constraints below. Where I state a preference, honor it; where I don't, decide and justify briefly in your plan.

## Start by loading your skills

Before any code, follow this project's normal workflow: use **superpowers:brainstorming** to pin down requirements and design, then **superpowers:writing-plans** to produce a written plan, then execute it with **superpowers:subagent-driven-development** (TDD per task, review after each). Do not skip the brainstorm — surface disagreements with the recommendations here before committing. Also load **frontend-design** when you get to visual design, and **claude-api** if you touch any Claude/Anthropic code.

## Current state (what already exists)

- The backend is a Node 22 / TypeScript (ESM) / Fastify REST API in `src/`, fully tested (46 vitest tests). It was built from `docs/superpowers/plans/2026-07-07-kintrace-backend-core.md` and is on branch `worktree-kintrace-backend-core` / PR #1 — read `CLAUDE.md` for its architecture and commands. Assume it is merged (or merge/branch from it) before you start.
- The backend already validates all its shapes with **zod** (`src/db.ts`, `src/dates.ts`, `src/ai/transcriber.ts`, `src/server.ts`). Reuse those schemas/types from the frontend rather than redefining them.
- It listens on `http://127.0.0.1:3271`, single-user, no auth. Data lives under `./data/`.

## Backend API contract (what your client calls)

> **Transcription shape depends on the ingestion-upgrade work** (`docs/2026-07-08-kintrace-ocr-htr-ingestion-prompt.md`). That change replaces the old single `transcription` field with a **diplomatic** + **normalized** pair and adds structured per-item confidence/flagged-span data from a two-pass HTR pipeline. The contract below already reflects the post-upgrade shape — confirm the exact field names and the confidence/flagged-span object against the backend once that work lands, and build the review UI to consume it.

- `GET /api/items?status=&personId=` → list: `{ id, title, media_type, date_start, date_end, date_precision, status, content_hash, thumb_path }`. Ordered by date (nulls last).
- `GET /api/items/:id` → full item incl. `transcription_diplomatic` (faithful text preserving line breaks + uncertainty markers `[illegible]`/`[?]`/`[possibly Name]`), `transcription_normalized` (modernized, search-friendly), a structured **confidence/flagged-spans** object (overall/section confidence + a list of low-confidence spans with text + reason — exact shape set by the ingestion work), `ai_names` (JSON string), `ai_error`, and `people: [{ id, name, role }]`. 404 if missing. (Either transcription may be null when the media has no text.)
- `PATCH /api/items/:id` → body `{ title?, description?, transcription_diplomatic?, transcription_normalized?, date?: { start?, end?, precision? }, status?: 'reviewed' }`. A reviewer can edit both transcriptions. Dates are normalized server-side. Setting `status: 'reviewed'` on a still-`pending` item returns **409** (must be `transcribed` first); any other `status` value → 400; malformed/empty body → 400.
- `POST /api/items/:id/people` → body `{ personId, role }` where role ∈ `subject|author|recipient`. 204 on success; 400 on bad role/id; 404 if item or person missing.
- `GET /api/people` / `POST /api/people` → list / create `{ name, notes? }` → 201 `{ id, name }`.
- `POST /api/import` → body `{ paths: string[], mediaType }` where mediaType ∈ `photo|letter|article|audio|video|pdf`. Returns **per-file** results, each `{ path, itemId, duplicate }` or `{ path, error }`. 400 on malformed body. (Note: import takes server-side file *paths*, not uploaded bytes — see "decisions to make".)
- `POST /api/queue/process` → runs one pass of the AI transcription queue; returns `{ processed, failed }`. **503** if the selected AI provider's key isn't configured. (Transcription runs on **OpenAI by default**, switchable to Claude via `TRANSCRIBE_PROVIDER`; from the frontend's side this is just "AI configured or not" — surface the 503 as a disabled/unavailable state.)

Domain model you must represent faithfully:
- **Fuzzy dates**: every dated thing has `date_start`, `date_end` (ISO `YYYY-MM-DD`) and `date_precision` ∈ `exact | month | year | decade | unknown`. A `year` item spans Jan 1–Dec 31; a `decade` spans 10 years; `unknown` has null dates. The UI must let a reviewer *see and edit* precision, not just a single date.
- **Status lifecycle**: `pending → transcribed → reviewed`, in that order only. The UI drives items through it; reviewed is the human-approved terminal state.
- **AI suggestions**: `transcription_diplomatic`, `transcription_normalized`, `title`, `description`, and `ai_names` are machine-generated and need human review/correction before an item is approved. The two-pass HTR pipeline also attaches per-item confidence and flagged low-confidence spans — the review UI should foreground these (e.g. highlight uncertain spans, show a diplomatic ↔ normalized toggle) so reviewers focus correction where reliability is lowest.
- **Media types**: `photo | letter | article | audio | video | pdf` — the UI renders each appropriately (image viewer, audio/video player, PDF viewer, text).

## Constraints (mine — honor these)

1. **Location**: put the app in a new **`web/`** subdirectory of this repo (its own `package.json`). Do not restructure the existing backend. Prefer importing the backend's zod schemas/types directly over redefining them; if a clean import boundary needs a small `shared/` extraction, propose it in your plan first.
2. **Open-source dependencies only.** No paid/commercial libraries. In particular, build the transcription diff / accept-reject review UI on free tooling (base Tiptap/ProseMirror, CodeMirror, or a custom diff) — do **not** use Tiptap's paid AI Suggestion feature.
3. **Local single-user now, cloud-portable later.** Build for `127.0.0.1` with no auth today, but keep the data-fetching/architecture boundaries clean enough that adding accounts + a hosted API later doesn't require a rewrite. Don't build multi-tenant/auth machinery now (YAGNI).
4. **Stage the work as a walking skeleton first.** Your first increment is one thin vertical slice, running against the *real* backend end-to-end: list items → open an item's detail → review/correct its AI fields → advance it `transcribed → reviewed`. Prove the stack and the integration, then expand feature-by-feature. Say so in your plan and structure tasks accordingly.
5. **Match the backend's standards**: TypeScript strict, ESM, tests that verify real behavior (no mock-only tests), commit after each green cycle. Tests must not hit a real backend or network — mock the HTTP layer / inject fakes. (The frontend talks only to the backend REST API, never to an AI provider directly.)

## Recommended stack (research-backed default — adopt unless you have a concrete reason not to)

A deep-research pass (2024–2026 sources, adversarially verified) converged on this; treat it as a strong default and note any deviation in your plan with rationale:

- **Build**: Vite + React + TypeScript SPA (no meta-framework — the app is behind-auth-later with no SEO/SSR need). Keep **React Router v7** as the upgrade path if a hosted/SSR future arrives. (patterns.dev; react.dev)
- **Server state**: **TanStack Query** owns *all* REST data via `useQuery`/`useMutation` — caching, invalidation, optimistic updates. Poll the transcription queue with `refetchInterval` as a function that returns an interval while work is pending and `false` when done (`refetchInterval: (q) => q.state.data?.status === 'complete' ? false : 2000`; add `refetchIntervalInBackground` if polling must continue on an unfocused tab). (tanstack.com/query polling guide)
- **Client state**: **Zustand** for UI-only state. **Never** duplicate server data into it — Query owns server state; duplication causes sync bugs. (TanStack docs; onebyzero)
- **Forms/validation**: **React Hook Form + Zod**. Reuse the backend's zod schemas to validate API responses *inside* the query function (`Schema.parse(data)`) so bad responses surface through Query's error state. (patterns.dev; tkdodo.eu)
- **Timeline axis**: **vis-timeline** — its native `range` items (start+end) map directly onto fuzzy month/year/decade spans; `exact` → point, `unknown` → omit/distinct. It has zoom/drag but **no** built-in uncertainty styling — you supply that. (github.com/visjs/vis-timeline)
- **Media-rich views**: optionally **react-chrono** for storytelling/detail (native images/video/custom components, multiple layouts) — but it's display-only (Day.js display strings, no date ranges, no zoom). Consider vis-timeline for the interactive axis + react-chrono for media detail, or one library; decide in brainstorming. (github.com/prabhuignoto/react-chrono; LogRocket)
- **Review UX pattern**: model on a **diff-and-approve** flow (preview AI changes as an inline diff, accept/reject per field) plus **confidence-aware, line-by-line** correction (à la Transkribus: per-line reliability, edit text, tag people/places/dates, then approve) — mapped onto `pending → transcribed → reviewed`. Build it open-source per constraint 2. (tiptap diff-view *as a pattern reference only*; transkribus.org)
- **Import/ingestion**: **Uppy 5.0** React components/hooks (Dashboard/Dropzone/`useDropzone`, real-time status + numeric progress) for the upload/queue UI. Note Uppy has **no** dedupe UI — you design that around the backend's `{ duplicate: true, itemId }` response. (uppy.io/docs/react)

## Decisions the research left open — make them, don't ask me

1. **How to visually encode date uncertainty** beyond plain bars (faded/gradient edges, hatching, confidence-scaled opacity, textual "c. 1943") — and whether to combine vis-timeline (axis) with react-chrono (media detail) or use one library. Pick an approach and justify it.
2. **The import UX reality**: `POST /api/import` takes server-side file *paths*, not uploaded file bytes. Decide how a browser client drives this for a local single-user tool — e.g. a small backend upload endpoint that stages dropped files to disk then calls import, vs. a local file-path picker, vs. proposing a backend change. If you need a new/changed backend endpoint, specify it in the plan and implement it to the same standard (TDD, zod, review).
3. **Duplicate-detection feedback UX**: how the UI presents `duplicate: true` results (skip/replace/keep-both, or just inform). Design it around the backend response.
4. **Design language**: choose a distinctive, intentional aesthetic for a family-history archive (use the frontend-design skill). It's yours to decide — commit to a clear direction rather than a templated default.

## Verification & definition of done

- Run the frontend against the **real running backend** (`npm run dev` in the repo root starts it on :3271) and drive the actual flows — don't declare a slice done on unit tests alone. Use the **verify** / **run** skills to exercise it in a real browser.
- Component/logic tests with vitest (+ React Testing Library or equivalent); the fuzzy-date ↔ timeline translation and the review-lifecycle transitions especially need real-behavior tests.
- Each task: typecheck clean, tests green, committed. Keep the app importing shared backend types so schema drift is a compile error, not a runtime surprise.
- The walking skeleton is "done" when a person can, in the browser against the live backend: see the item list, open an item, correct its AI-suggested transcription (both diplomatic and normalized, with flagged low-confidence spans surfaced)/title/date(with precision)/names, link a person, and advance it to `reviewed` — with the timeline rendering at least that item's fuzzy date correctly.

Begin with brainstorming. Ask me anything you need before writing the plan; otherwise produce the plan, show it to me for approval, then execute it task-by-task.
