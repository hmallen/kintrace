# KinTrace Frontend v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the KinTrace React web client — browse imported archival items, review/correct two-pass HTR transcriptions and metadata, drive items `pending → transcribed → reviewed`, and render everything on an interactive fuzzy-date timeline — against the existing Fastify backend on `http://127.0.0.1:3271`.

**Architecture:** A Vite + React + TypeScript SPA in a new top-level `web/` (its own `package.json`), talking only to the backend REST API through a zod-parsed `apiFetch` wrapper with TanStack Query owning all server state. A new top-level `shared/` plain-TS directory holds the single wire contract (zod schemas + fuzzy-date logic) that both the backend (relative import) and the web app (`@shared` alias) are pinned to, so schema drift becomes a compile/parse error. The backend gains three streaming/ingest endpoints; everything else in `src/` is untouched.

**Tech Stack:** Vite + React 19 + TypeScript (strict, ESM), React Router v7 (SPA mode), TanStack Query, Zustand (UI-only state), React Hook Form + zod, vis-timeline, CodeMirror 6, Uppy 5 (Dashboard/React + XHRUpload), MSW + vitest + React Testing Library. Backend: Fastify 5, better-sqlite3, zod 4, `@fastify/multipart`, vitest. All dependencies open-source (never Tiptap paid features).

**Spec:** `docs/superpowers/specs/2026-07-08-kintrace-frontend-design.md` — read it first; it is the authority on shapes and behavior. Original requirements: `docs/2026-07-07-kintrace-frontend-build-prompt.md`.

## Model roles

- **Every implementer (code-writing) subagent MUST be dispatched with `model: claude-fable-5`** — overriding subagent-driven-development's cheapest-capable default. This is a deliberate quality/consistency choice.
- **Every task reviewer runs on Opus 4.8.** The **final whole-branch review also runs on Opus 4.8** (most capable available).
- The controller/orchestration session may run on Fable 5.

## Global Constraints

- TypeScript strict + ESM everywhere (backend and `web/`).
- Open-source dependencies only — never Tiptap paid features (transcription review UI is CodeMirror 6, free).
- Tests never hit a real backend or network: **MSW at the network boundary for `web/`, injected fakes for the backend**.
- Commit after each green cycle (typecheck clean + tests green).
- `web/` has its own `package.json`; run web tests/typecheck from inside `web/`.
- `shared/` is a plain TS directory — **no npm workspaces**; backend imports it by relative path (`../shared/*.js`), web via the `@shared` Vite/tsconfig alias + `server.fs.allow`.
- Client base URL is `import.meta.env.VITE_API_BASE ?? ''`.
- Vite dev proxy `/api` → `http://127.0.0.1:3271` (no CORS work).
- Backend archive originals are never modified after import.
- Item status only moves `pending → transcribed → reviewed`, never backwards.
- `ai_confidence` is display-only — it is **never** included in a PATCH body.
- No TBD/TODO/placeholder text may remain in shipped code.

## Naming & type registry (single source of truth — keep consistent across all tasks)

Exported from **`shared/api.ts`** (zod schemas + inferred types unless noted):

- `MediaTypeSchema` = `z.enum(['photo','letter','article','audio','video','pdf'])`; type `MediaType`.
- `StatusSchema` = `z.enum(['pending','transcribed','reviewed'])`; type `Status`.
- `PersonRoleSchema` = `z.enum(['subject','author','recipient'])`; type `PersonRole`.
- `PrecisionSchema` = `z.enum(PRECISION_VALUES)` (imported tuple from `./dates.js`); type `Precision` (re-exported from `./dates.js`).
- `ConfidenceSchema` = `z.object({ overall: z.enum(['high','medium','low']), summary: z.string(), flaggedSpans: z.array(z.object({ text: z.string(), reason: z.string() })) })`; type `AiConfidence`.
- `PersonRefSchema` = `z.object({ id: z.number(), name: z.string(), role: PersonRoleSchema })`; type `PersonRef`.
- `ItemSummarySchema`; type `ItemSummary`.
- `ItemDetailSchema`; type `ItemDetail`.
- `PersonSchema`; type `Person`.
- `CreatePersonBodySchema`; type `CreatePersonBody`. `CreatePersonResultSchema`; type `CreatePersonResult`.
- `ImportResultSchema`; type `ImportResult`.
- `QueueResultSchema`; type `QueueResult`.
- `PatchItemBodySchema`; type `PatchItemBody`.
- `LinkPersonBodySchema`; type `LinkPersonBody`.

Exported from **`shared/dates.ts`**: `PRECISION_VALUES` (readonly tuple), type `Precision`, interface `FuzzyDate`, `normalizeFuzzyDate`.

Web-side canonical names (defined in the task that creates them, reused verbatim later):

- `apiFetch<T>(path, schema, init?)`, class `ApiError`.
- Hooks: `useItems`, `useItem`, `usePeople`, `useUpdateItem`, `useLinkPerson`, `useCreatePerson`, `useProcessQueue`.
- Query keys: `['items', filters]`, `['item', id]`, `['people']`.
- Timeline: `toTimelineData`, `formatDateLabel`, interface `TimelineDatum`.
- Review: `findFlaggedSpans`, `findUncertaintyMarkers`, `buildDecorations`, `isSpanResolved`, interface `SpanMatch`.

---

# Stage 0 — Contract + media plumbing

Backend only. Existing 46-test backend suite must stay green after every task. Run backend tests with `npx vitest run tests/<file>` and the full suite with `npm test`; typecheck with `npm run typecheck` (all from repo root).

---

### Task 1: Extract `shared/dates.ts`; `src/dates.ts` becomes a re-export

**Files:**
- Create: `shared/dates.ts`
- Modify: `src/dates.ts` (replace body with a re-export)
- Modify: `tsconfig.json` (add `"shared"` to `include`)
- Test: existing `tests/dates.test.ts` (unchanged — proves behavior preserved)

**Interfaces:**
- Produces (from `shared/dates.ts`):
  ```ts
  export const PRECISION_VALUES = ['exact','month','year','decade','unknown'] as const;
  export type Precision = typeof PRECISION_VALUES[number];
  export interface FuzzyDate { start: string | null; end: string | null; precision: Precision; }
  export function normalizeFuzzyDate(input: { start?: string | null; end?: string | null; precision?: string | null }): FuzzyDate;
  ```
  Logic is moved **verbatim** from the current `src/dates.ts` (exact/month/year/decade/unknown handling, calendar validation, explicit-range passthrough). Internally `PRECISIONS` is replaced by `PRECISION_VALUES`.
- `src/dates.ts` becomes exactly: `export { normalizeFuzzyDate, PRECISION_VALUES } from '../shared/dates.js'; export type { Precision, FuzzyDate } from '../shared/dates.js';` (so `src/importer`, `src/server`, `src/ai/queue` imports keep working).

**Test specs (reuse existing `tests/dates.test.ts` as-is):**
- All existing date cases still pass unchanged (year → Jan 1–Dec 31; month → first–last day; decade → floor decade 10-year span; unknown/invalid → null/null/unknown; explicit valid `end ≥ start` preserved).

**TDD steps:**
- [ ] Run `npx vitest run tests/dates.test.ts` — baseline PASS (before change).
- [ ] Create `shared/dates.ts` (moved logic); rewrite `src/dates.ts` as re-export; add `"shared"` to `tsconfig.json` include.
- [ ] Run `npx vitest run tests/dates.test.ts` → PASS; `npm test` → all green; `npm run typecheck` → clean.
- [ ] Commit: `refactor: extract fuzzy-date logic into shared/dates.ts (src/dates.ts re-exports)`

**Acceptance criteria:**
- `shared/dates.ts` is the only implementation; `src/dates.ts` re-exports it.
- No behavior change; full backend suite green; typecheck clean.

---

### Task 2: `shared/api.ts` wire contract; relocate `ConfidenceSchema`; backend contract test

**Files:**
- Create: `shared/api.ts`
- Create: `tests/shared-contract.test.ts`
- Modify: `src/ai/transcriber.ts` (import `ConfidenceSchema` from `../../shared/api.js` and re-export it; delete the local definition — keep `DraftSchema`/`VerifiedSchema` using the imported `ConfidenceSchema`)
- Test: existing `tests/transcriber.test.ts`, `tests/queue.test.ts`, `tests/server.test.ts` (unchanged — prove nothing broke)

**Interfaces (produced by `shared/api.ts` — exact):**
```ts
import { z } from 'zod';
import { PRECISION_VALUES } from './dates.js';

export const MediaTypeSchema = z.enum(['photo','letter','article','audio','video','pdf']);
export type MediaType = z.infer<typeof MediaTypeSchema>;

export const StatusSchema = z.enum(['pending','transcribed','reviewed']);
export type Status = z.infer<typeof StatusSchema>;

export const PersonRoleSchema = z.enum(['subject','author','recipient']);
export type PersonRole = z.infer<typeof PersonRoleSchema>;

export const PrecisionSchema = z.enum(PRECISION_VALUES);
export type { Precision } from './dates.js';

export const ConfidenceSchema = z.object({
  overall: z.enum(['high','medium','low']),
  summary: z.string(),
  flaggedSpans: z.array(z.object({ text: z.string(), reason: z.string() })),
});
export type AiConfidence = z.infer<typeof ConfidenceSchema>;

export const PersonRefSchema = z.object({ id: z.number(), name: z.string(), role: PersonRoleSchema });
export type PersonRef = z.infer<typeof PersonRefSchema>;

export const ItemSummarySchema = z.object({
  id: z.number(),
  title: z.string().nullable(),
  media_type: MediaTypeSchema,
  date_start: z.string().nullable(),
  date_end: z.string().nullable(),
  date_precision: PrecisionSchema,
  status: StatusSchema,
  content_hash: z.string(),
  thumb_path: z.string().nullable(),
});
export type ItemSummary = z.infer<typeof ItemSummarySchema>;

export const ItemDetailSchema = ItemSummarySchema.extend({
  file_path: z.string(),
  created_at: z.string(),
  description: z.string().nullable(),
  transcription_diplomatic: z.string().nullable(),
  transcription_normalized: z.string().nullable(),
  ai_error: z.string().nullable(),
  ai_names: z.string().nullable(),          // JSON string, NOT parsed
  ai_confidence: ConfidenceSchema.nullable(), // parsed object | null
  people: z.array(PersonRefSchema),
});
export type ItemDetail = z.infer<typeof ItemDetailSchema>;

export const PersonSchema = z.object({ id: z.number(), name: z.string(), notes: z.string().nullable() });
export type Person = z.infer<typeof PersonSchema>;

export const CreatePersonBodySchema = z.object({ name: z.string().min(1), notes: z.string().optional() });
export type CreatePersonBody = z.infer<typeof CreatePersonBodySchema>;
export const CreatePersonResultSchema = z.object({ id: z.number(), name: z.string() });
export type CreatePersonResult = z.infer<typeof CreatePersonResultSchema>;

export const ImportResultSchema = z.union([
  z.object({ path: z.string(), itemId: z.number(), duplicate: z.boolean() }),
  z.object({ path: z.string(), error: z.string() }),
]);
export type ImportResult = z.infer<typeof ImportResultSchema>;

export const QueueResultSchema = z.object({ processed: z.number(), failed: z.number() });
export type QueueResult = z.infer<typeof QueueResultSchema>;

export const PatchItemBodySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  transcription_diplomatic: z.string().optional(),
  transcription_normalized: z.string().optional(),
  date: z.object({
    start: z.string().nullable().optional(),
    end: z.string().nullable().optional(),
    precision: PrecisionSchema.optional(),
  }).optional(),
  status: z.literal('reviewed').optional(),
});
export type PatchItemBody = z.infer<typeof PatchItemBodySchema>;

export const LinkPersonBodySchema = z.object({ personId: z.number(), role: PersonRoleSchema });
export type LinkPersonBody = z.infer<typeof LinkPersonBodySchema>;
```

- `PersonSchema`, `ItemSummarySchema`, `ItemDetailSchema` rely on zod's default behavior of **stripping** unknown keys (so `SELECT *` rows carrying `birth_start` etc. parse fine).
- `src/ai/transcriber.ts`: `import { ConfidenceSchema } from '../../shared/api.js';` then `export { ConfidenceSchema };` — its `DraftSchema`/`VerifiedSchema` continue to reference the same `ConfidenceSchema`. Existing tests importing from `transcriber.ts` keep working.

**Wire-shape decisions pinned (must hold):**
- `ai_confidence` is a parsed object or `null` (never a string).
- `ai_names` stays a raw JSON string (or null).
- Both `transcription_diplomatic` and `transcription_normalized` are nullable.

**Test specs (`tests/shared-contract.test.ts`, backend style with in-memory DB + `app.inject`):**
1. `GET /api/items list parses as ItemSummary[]` — seed one item; assert `ItemSummarySchema.array().parse(res.json())` does not throw.
2. `GET /api/items/:id parses as ItemDetail` — seed item with `ai_confidence` JSON, `ai_names` JSON, one linked person; assert `ItemDetailSchema.parse(res.json())` succeeds, and the parsed `ai_confidence` is an object with `overall`, and `ai_names` is a `string`.
3. `GET /api/items/:id with null AI fields parses` — fresh pending item (nulls) → `ItemDetailSchema.parse` succeeds with `ai_confidence === null`, `transcription_diplomatic === null`.
4. `GET /api/people parses as Person[]` — create a person → `PersonSchema.array().parse(res.json())` succeeds (extra birth/death columns stripped).
5. `POST /api/people result parses as CreatePersonResult` — `CreatePersonResultSchema.parse(res.json())` succeeds.
6. `PATCH result parses as ItemDetail` — patch a transcribed item's title → `ItemDetailSchema.parse(res.json())` succeeds.

**TDD steps:**
- [ ] Write `tests/shared-contract.test.ts`; run `npx vitest run tests/shared-contract.test.ts` → FAIL (`shared/api.ts` missing).
- [ ] Create `shared/api.ts`; relocate `ConfidenceSchema` into it; update `src/ai/transcriber.ts` import + re-export.
- [ ] Run `npx vitest run tests/shared-contract.test.ts tests/transcriber.test.ts` → PASS; `npm test` → all green; `npm run typecheck` → clean.
- [ ] Commit: `feat: add shared/api.ts wire contract and relocate ConfidenceSchema`

**Acceptance criteria:**
- Every current endpoint's real response `.parse()`es against its shared schema.
- `ConfidenceSchema` lives in `shared/api.ts`, re-exported from `transcriber.ts`; no behavior change; full suite green.

---

### Task 3: Media streaming endpoints — `GET /api/items/:id/thumbnail` and `GET /api/items/:id/file`

**Files:**
- Modify: `src/server.ts` (two new routes)
- Create: `tests/media.test.ts`

**Interfaces:**
- Consumes: `ServerDeps` (unchanged), the items table columns `thumb_path`, `file_path`.
- Produces: two routes, no new exported symbols.

**Behavior (exact):**
- `GET /api/items/:id/thumbnail`:
  - 404 `{ error: 'not found' }` if the item id does not exist.
  - 404 `{ error: 'not found' }` if the item exists but `thumb_path` is null OR the file at `thumb_path` is missing on disk.
  - Otherwise stream the JPEG with `Content-Type: image/jpeg`.
- `GET /api/items/:id/file`:
  - 404 `{ error: 'not found' }` if the item id does not exist, `file_path` is null, or the file is missing on disk.
  - Otherwise stream the archived original: `Content-Type` inferred from the file extension (`.jpg`/`.jpeg`→`image/jpeg`, `.png`→`image/png`, `.tif`/`.tiff`→`image/tiff`, `.webp`→`image/webp`, `.pdf`→`application/pdf`, `.mp3`→`audio/mpeg`, `.wav`→`audio/wav`, `.mp4`→`video/mp4`, `.mov`→`video/quicktime`, `.webm`→`video/webm`; fallback `application/octet-stream`), `Content-Disposition: inline`.
- Both use a Node read stream (`fs.createReadStream`) sent via Fastify `reply.type(...).send(stream)`; existence checked with `fs.existsSync` before streaming.

**Test specs (`tests/media.test.ts`, in-memory DB + real temp files under an OS temp dir):**
1. `thumbnail 404 for missing item` — GET `/api/items/999/thumbnail` → 404.
2. `thumbnail 404 when thumb_path null` — seed item without thumb → 404.
3. `thumbnail 404 when file missing on disk` — seed item with a `thumb_path` pointing at a nonexistent file → 404.
4. `thumbnail streams jpeg` — write a small real JPEG to a temp path, seed item with that `thumb_path` → 200, `content-type` starts with `image/jpeg`, body length > 0.
5. `file 404 for missing item` — GET `/api/items/999/file` → 404.
6. `file streams with extension-inferred type` — write a temp `.png`, seed item `file_path` → 200, `content-type` === `image/png`, `content-disposition` === `inline`.
7. `file falls back to octet-stream` — temp file with unknown extension `.xyz` → 200, `content-type` === `application/octet-stream`.

**TDD steps:**
- [ ] Write `tests/media.test.ts`; run `npx vitest run tests/media.test.ts` → FAIL (routes 404 as generic/not implemented).
- [ ] Implement both routes in `src/server.ts`.
- [ ] Run `npx vitest run tests/media.test.ts` → PASS; `npm test` → all green; `npm run typecheck` → clean.
- [ ] Commit: `feat: stream item thumbnail and original file endpoints`

**Acceptance criteria:**
- Both endpoints stream real bytes with correct content types and 404 on any missing item/file, verified by tests using real temp files.

---

# Stage 1 — Walking skeleton (against the live backend, end to end)

Each Stage 1 task is shippable. Web tests run from inside `web/`: `cd web && npx vitest run src/<path>`; web typecheck `cd web && npm run typecheck`. The stage ends with an in-browser verification (Task 9) against the real backend started via `npm run dev` at the repo root.

---

### Task 4: `web/` scaffold — Vite + React + TS strict, Router, Query, MSW, smoke test

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/tsconfig.node.json`, `web/vite.config.ts`, `web/index.html`, `web/.gitignore`
- Create: `web/src/main.tsx`, `web/src/App.tsx`, `web/src/router.tsx`, `web/src/queryClient.ts`
- Create: `web/src/test/setup.ts`, `web/src/test/msw.ts`, `web/src/test/handlers.ts`
- Create: `web/src/App.test.tsx` (smoke)

**Dependencies (web/package.json):**
- deps: `react`, `react-dom`, `react-router-dom@^7`, `@tanstack/react-query@^5`, `zustand`, `react-hook-form`, `@hookform/resolvers`, `zod@^4` (same major as backend), `vis-timeline`, `vis-data`, `@codemirror/state`, `@codemirror/view`, `@uppy/core`, `@uppy/dashboard`, `@uppy/react`, `@uppy/xhr-upload`.
- devDeps: `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `msw`, `@types/react`, `@types/react-dom`.
- scripts: `"dev": "vite"`, `"build": "tsc -b && vite build"`, `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`.

**Config contracts:**
- `web/tsconfig.json`: `"strict": true`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"jsx": "react-jsx"`, `"types": ["vite/client","vitest/globals","@testing-library/jest-dom"]`, `"baseUrl": "."`, `"paths": { "@shared/*": ["../shared/*"] }`, `"include": ["src","../shared"]`.
- `web/vite.config.ts` (also read by Vitest):
  - `plugins: [react()]`
  - `resolve.alias`: `{ '@shared': path.resolve(__dirname, '../shared') }`
  - `server.proxy`: `{ '/api': { target: 'http://127.0.0.1:3271', changeOrigin: true } }`
  - `server.fs.allow`: `['..']` (so the dev server can read `../shared`)
  - `test`: `{ environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], css: false }`
  - Note: Vite resolves `@shared/api` → `../shared/api.ts`, and shared internal `./dates.js` imports resolve to `./dates.ts` (Vite `.js`→`.ts` fallback). No backend code is bundled.
- `web/src/queryClient.ts`: exports a `makeQueryClient()` factory returning a `QueryClient` with `defaultOptions.queries = { retry: false, refetchOnWindowFocus: false }` (deterministic tests).
- `web/src/test/msw.ts`: `export const server = setupServer(...handlers)`.
- `web/src/test/setup.ts`: `beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))`, `afterEach(() => server.resetHandlers())`, `afterAll(() => server.close())`; import `@testing-library/jest-dom`.
- `web/src/test/handlers.ts`: exports `handlers` array (starts with a `GET /api/items` returning `[]`); base path is relative (`'/api/items'`) — MSW intercepts the same relative URLs `apiFetch` builds.
- `web/src/router.tsx`: `createBrowserRouter` with routes `/` (Library), `/items/:id` (Workspace), `/timeline` (Timeline), `/import` (Import), `/people` (People) — placeholder components acceptable this task; real ones land in later tasks.
- `web/src/main.tsx`: wraps `<RouterProvider>` in `<QueryClientProvider client={makeQueryClient()}>`.

**Test specs (`web/src/App.test.tsx`):**
1. `renders app shell` — render `<App>` (or the router with `MemoryRouter`/`createMemoryRouter`) wrapped in a `QueryClientProvider`; assert a recognizable landmark renders (e.g. the app title "KinTrace" in a banner/heading). No network assertion beyond MSW default handler not erroring.

**TDD steps:**
- [ ] Scaffold config files + `src` entry files + `test` harness + placeholder routes.
- [ ] Write `web/src/App.test.tsx`; run `cd web && npx vitest run src/App.test.tsx` → PASS (smoke).
- [ ] Run `cd web && npm run typecheck` → clean; `cd web && npm run build` → succeeds.
- [ ] Commit: `feat(web): scaffold Vite+React+TS SPA with Query, Router, MSW test harness`

**Acceptance criteria:**
- `web/` builds, typechecks strict-clean, smoke test green.
- `@shared` alias resolves in both Vite and Vitest; dev proxy + `server.fs.allow` configured.

---

### Task 5: Data layer — `apiFetch`, `ApiError`, query/mutation hooks

**Files:**
- Create: `web/src/api/client.ts`, `web/src/api/client.test.ts`
- Create: `web/src/api/hooks.ts`, `web/src/api/hooks.test.tsx`
- Modify: `web/src/test/handlers.ts` (add handlers used by these tests)

**Interfaces (produced — exact):**
```ts
// client.ts
export class ApiError extends Error {
  readonly status: number;
  readonly serverMessage?: string; // the server body's `error` field when present
  constructor(status: number, serverMessage: string | undefined, message: string);
}
const API_BASE = import.meta.env.VITE_API_BASE ?? '';
export async function apiFetch<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T>;

// hooks.ts
import type { ItemSummary, ItemDetail, Person, PatchItemBody, LinkPersonBody, CreatePersonBody, CreatePersonResult, Status } from '@shared/api.js';
export interface ItemFilters { status?: Status; personId?: number; }
export function useItems(filters: ItemFilters): UseQueryResult<ItemSummary[], ApiError>;
export function useItem(id: number): UseQueryResult<ItemDetail, ApiError>;
export function usePeople(): UseQueryResult<Person[], ApiError>;
export function useUpdateItem(id: number): UseMutationResult<ItemDetail, ApiError, PatchItemBody>;
export function useLinkPerson(itemId: number): UseMutationResult<void, ApiError, LinkPersonBody>;
export function useCreatePerson(): UseMutationResult<CreatePersonResult, ApiError, CreatePersonBody>;
```

**Behavior (exact):**
- `apiFetch` builds `` `${API_BASE}${path}` ``, sets `Content-Type: application/json` and JSON-stringifies `init.body` only when a body is provided as a plain object (helper may accept `init.body` already stringified — pin: hooks pass a plain object via a small `json()` helper OR `apiFetch` stringifies objects). Pin the simplest: hooks pass `{ method, body: JSON.stringify(...) }` and `apiFetch` sets the header when `init?.body` is present.
- On non-2xx: read the body, extract `error` string if the body parses as `{ error: string }`, throw `new ApiError(status, thatMessage, thatMessage ?? \`HTTP ${status}\`)`. For 204 (no content) resolve without parsing — `apiFetch` should only be used with a schema for bodied responses; provide a sibling `apiSend(path, init?)` returning `Promise<void>` for 204 endpoints (used by `useLinkPerson`).
- On 2xx with body: `schema.parse(await res.json())`; a zod failure throws (surfaces as query/mutation error) — wrap as `ApiError(res.status, undefined, zodError.message)` or rethrow the ZodError; **pin: rethrow the ZodError unchanged** so error boundaries can distinguish parse failures. (Test asserts the promise rejects.)
- URL building for `useItems`: query string from `filters` — include `status` and `personId` only when defined; empty filters → `/api/items`.
- Query keys: `useItems` → `['items', filters]`; `useItem` → `['item', id]`; `usePeople` → `['people']`.
- Invalidation (via the shared `QueryClient`):
  - `useUpdateItem(id)` `onSuccess` → invalidate `['item', id]` **and** `['items']` (prefix). Also performs an **optimistic update** of the `['item', id]` cache by merging the patched fields, with rollback on error (`onMutate`/`onError`/`onSettled`).
  - `useLinkPerson(itemId)` `onSuccess` → invalidate `['item', itemId]`.
  - `useCreatePerson()` `onSuccess` → invalidate `['people']`.
- Endpoint mapping:
  - `useItems` → `GET /api/items[?...]` parse `ItemSummarySchema.array()`.
  - `useItem` → `GET /api/items/:id` parse `ItemDetailSchema`.
  - `usePeople` → `GET /api/people` parse `PersonSchema.array()`.
  - `useUpdateItem` → `PATCH /api/items/:id` body = `PatchItemBody`, parse `ItemDetailSchema`.
  - `useLinkPerson` → `POST /api/items/:id/people` body = `LinkPersonBody`, 204 → `apiSend`.
  - `useCreatePerson` → `POST /api/people` body = `CreatePersonBody`, parse `CreatePersonResultSchema`.

**Test specs:**

`client.test.ts` (MSW-backed):
1. `parses a valid body` — handler returns a valid `ItemSummary[]`; `apiFetch('/api/items', ItemSummarySchema.array())` resolves to the parsed array.
2. `throws ApiError on 404 with server message` — handler returns 404 `{ error: 'not found' }`; assert rejects with `ApiError`, `.status === 404`, `.serverMessage === 'not found'`.
3. `throws ApiError on 409` — handler 409 `{ error: 'item not transcribed yet' }`; `.status === 409`, `.serverMessage === 'item not transcribed yet'`.
4. `rejects on schema mismatch` — handler returns `{ nope: 1 }`; `apiFetch('/api/items', ItemSummarySchema.array())` rejects (ZodError).
5. `apiSend resolves on 204` — handler 204; `apiSend('/api/items/1/people', { method:'POST', body: JSON.stringify({personId:1,role:'subject'}) })` resolves to `undefined`.

`hooks.test.tsx` (render hooks with a `QueryClientProvider` + MSW):
6. `useItems passes filters into the query string` — spy handler asserts request URL includes `status=transcribed` when `useItems({ status:'transcribed' })`; returns items → hook `data` populated.
7. `useUpdateItem sends only provided fields` — call mutation with `{ title: 'X' }`; MSW handler captures the request body and asserts it **equals** `{ title: 'X' }` (no other keys); on success the `['item', id]` cache reflects the merged title.
8. `useUpdateItem approve sends {status:'reviewed'} only` — mutate `{ status: 'reviewed' }`; captured body **equals** `{ status: 'reviewed' }`.
9. `useCreatePerson invalidates people` — after create, a subsequent `usePeople` refetch includes the new person (assert refetch triggered / list contains it).
10. `useLinkPerson posts LinkPersonBody` — captured body equals `{ personId: 5, role: 'author' }`.

**TDD steps:**
- [ ] Write `client.test.ts` + `hooks.test.tsx`; add MSW handlers; run `cd web && npx vitest run src/api` → FAIL.
- [ ] Implement `client.ts` (+ `apiSend`) and `hooks.ts`.
- [ ] Run `cd web && npx vitest run src/api` → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): typed apiFetch + zod-parsing Query/mutation hooks`

**Acceptance criteria:**
- Every response is zod-parsed; non-2xx throws typed `ApiError` carrying status + server message.
- Mutations send only changed fields and invalidate the correct keys; tests assert exact request bodies.

---

### Task 6: App shell + Library route (`/`)

**Files:**
- Create: `web/src/routes/Library.tsx`, `web/src/routes/Library.test.tsx`
- Create: `web/src/components/AppShell.tsx` (header/nav: links to Library, Timeline, Import, People; header actions area)
- Create: `web/src/components/StatusChip.tsx`, `web/src/components/MediaTypeIcon.tsx`, `web/src/components/Thumbnail.tsx`
- Modify: `web/src/router.tsx` (Library becomes the real `/` element; wrap routes in `AppShell` layout route)
- Modify: `web/src/test/handlers.ts`

**Interfaces:**
- Consumes: `useItems`, `ItemFilters`, `ItemSummary`, `Status`, `MediaType`.
- Produces: `Library` route component; `formatDateLabel` in `web/src/timeline/translate.ts` (contract below — Task 8 consumes it); `ThumbnailProps { itemId: number; alt: string }` rendering `<img src={\`${API_BASE}/api/items/${itemId}/thumbnail\`}>` with a graceful fallback (media-type icon) on error.

**Behavior:**
- Grid of cards, one per item: thumbnail (or media-type icon fallback), title (or "Untitled"), `StatusChip`, `MediaTypeIcon`, date label from `formatDateLabel(item.date_start, item.date_precision)`.
- Filters read from URL params (`useSearchParams`): `status` and `personId`. A status filter control (all / pending / transcribed / reviewed) updates the `status` param; changing it updates `useItems` filters. `personId` param (set by People screen / person links) filters the list and shows a "filtered by person" indicator with a clear-filter control.
- Header (`AppShell`) shows nav + an actions slot (Import link; Process-queue button lands in Task 16).
- Clicking a card navigates to `/items/:id`.

**`formatDateLabel` contract (create in `web/src/timeline/translate.ts`):**
```ts
import type { Precision } from '@shared/api.js';
export function formatDateLabel(dateStart: string | null, precision: Precision): string;
```
- Uses a fixed `MONTHS = ['January',...,'December']` array (no `Intl`, for deterministic output).
- `exact` → `"May 12, 1943"` (`${MONTHS[m-1]} ${day}, ${year}`, day without leading zero).
- `month` → `"May 1943"`.
- `year` → `"1943"`.
- `decade` → `"c. 1940s"` (`c. ${Math.floor(year/10)*10}s`).
- `unknown` or `dateStart === null` → `"Undated"`.

**Test specs:**

`translate.test.ts` (unit — `formatDateLabel`):
1. exact `('1943-05-12','exact')` → `"May 12, 1943"`.
2. month `('1943-05-01','month')` → `"May 1943"`.
3. year `('1943-01-01','year')` → `"1943"`.
4. decade `('1940-01-01','decade')` → `"c. 1940s"`.
5. unknown `(null,'unknown')` → `"Undated"`; also `('1943-05-12','unknown')` → `"Undated"`.

`Library.test.tsx` (RTL + MSW):
6. `renders a card per item` — MSW returns 3 items → 3 cards with their titles / status chips.
7. `status filter drives the query` — set `?status=pending`; assert the request carried `status=pending` and only matching items render (MSW keys off the query param).
8. `person filter shows indicator + clear` — render at `/?personId=5`; assert a "filtered by person" indicator and a clear control that navigates to `/`.
9. `card click navigates to workspace` — click a card → route becomes `/items/:id` (assert Workspace placeholder/heading or a spy on navigation).
10. `thumbnail falls back to icon on error` — simulate `<img>` `onError`; assert media-type icon shown.

**TDD steps:**
- [ ] Write `translate.test.ts` (formatDateLabel) + `Library.test.tsx`; run `cd web && npx vitest run src/timeline/translate.test.ts src/routes/Library.test.tsx` → FAIL.
- [ ] Implement `formatDateLabel`, `AppShell`, `StatusChip`, `MediaTypeIcon`, `Thumbnail`, `Library`; wire router layout.
- [ ] Run those tests → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): app shell + library grid with status/person URL filters`

**Acceptance criteria:**
- Library renders a filtered grid driven by URL params; date labels honest per precision; navigation to workspace works.

---

### Task 7: Review workspace (`/items/:id`) v1 — textarea editing, confidence banner, metadata + people, lifecycle

**Files:**
- Create: `web/src/routes/Workspace.tsx`, `web/src/routes/Workspace.test.tsx`
- Create: `web/src/components/ConfidenceBanner.tsx`, `web/src/components/FlaggedSpansList.tsx`, `web/src/components/MediaViewer.tsx` (image-only this task; `<img src=/api/items/:id/file>` with zoom/pan acceptable-minimal), `web/src/components/MetadataForm.tsx`, `web/src/components/FuzzyDateEditor.tsx`, `web/src/components/PeoplePanel.tsx`
- Modify: `web/src/router.tsx`, `web/src/test/handlers.ts`

**Interfaces:**
- Consumes: `useItem`, `useUpdateItem`, `usePeople`, `useLinkPerson`, `useCreatePerson`, `normalizeFuzzyDate` (from `@shared/dates.js`), `formatDateLabel`, types `ItemDetail`, `PatchItemBody`, `PersonRole`, `Precision`, `AiConfidence`.
- Produces: `Workspace` route; `FuzzyDateEditor` with contract:
  ```ts
  interface FuzzyDateEditorValue { start: string | null; precision: Precision; }
  // emits changes; shows a live preview computed by normalizeFuzzyDate({ start, precision })
  ```

**Behavior (exact):**
- Two panes (stacked on narrow screens): media viewer left (image via `/api/items/:id/file`), review panel right.
- **Confidence banner**: overall badge (`high`/`medium`/`low`) + `summary`; renders `ai_error` (when present) as an error notice; when `ai_confidence === null` show a muted "not yet transcribed" note.
- **Transcription editor v1**: plain `<textarea>` per transcription with a diplomatic ↔ normalized **tab toggle** (diplomatic default). Editing updates local form state, not the server until Save. When a transcription is `null`, show a "no text detected" empty state with a "start transcription" action that seeds an empty editable string.
- **Flagged-spans list** (surfaced, not inline-highlighted yet): list each `ai_confidence.flaggedSpans[]` as `text` + `reason`.
- **Metadata form** (RHF + zod using `PatchItemBodySchema`-compatible shape): `title`, `description`, and `FuzzyDateEditor` (date input + precision `<select>` over `PRECISION_VALUES`). Live preview text uses `normalizeFuzzyDate({ start, precision })` → e.g. `"Jan 1 – Dec 31, 1943"` (render start–end range; when unknown → "Undated / no date"). `precision === 'unknown'` **disables** the date input.
- **People panel**: role-grouped chips of `item.people` (subject/author/recipient); an add-link picker = existing-person `<select>` (from `usePeople`) + role `<select>` → `useLinkPerson`; inline "create person" (name input) → `useCreatePerson` then auto-link. (`ai_names` suggestion chips are deferred to Task 18.)
- **Lifecycle**:
  - **Save** button → `useUpdateItem` with **only changed fields** (diff current form vs loaded `item`): any of `title`, `description`, `transcription_diplomatic`, `transcription_normalized`, `date`. Optimistic (via hook). `date` sent as `{ start, precision }` (end computed server-side); when precision `unknown`, `start: null`.
  - **Mark reviewed** button (separate) → `useUpdateItem` with `{ status: 'reviewed' }` **only**. Disabled when `item.status === 'pending'`, showing the reason "item hasn't been transcribed yet". A raced **409** (server rejects) surfaces the same message inline next to the button.
  - Status chip always visible.
  - `ai_confidence` is **never** part of any PATCH body.

**Test specs (`Workspace.test.tsx`, RTL + MSW):**
1. `renders AI fields` — MSW returns a transcribed item with both transcriptions, `ai_confidence` (overall medium, 1 flagged span), `ai_error` null; assert overall badge "medium", summary text, both textareas' values behind the tab toggle, and the flagged span's text+reason listed.
2. `tab toggle switches transcription` — default shows diplomatic; click "Normalized" → textarea shows normalized value.
3. `save sends only changed fields` — edit title only, click Save; captured PATCH body **equals** `{ title: '<new>' }` (no `description`, no `date`, no transcription keys, no `ai_confidence`).
4. `save sends date with precision` — set date `1943-01-01`, precision `year`, Save; body **equals** `{ date: { start: '1943-01-01', precision: 'year' } }` (assuming only date changed).
5. `unknown precision disables date input and nulls start` — choose precision `unknown`; date input disabled; Save (if date changed) sends `{ date: { start: null, precision: 'unknown' } }`.
6. `date preview uses normalizeFuzzyDate` — with `1943-01-01` + `year`, preview text contains "1943" start and "Dec 31" end (range), matching `normalizeFuzzyDate` output.
7. `approve disabled on pending with reason` — MSW returns a `pending` item; Mark-reviewed button disabled; reason "item hasn't been transcribed yet" visible.
8. `approve flips status on transcribed` — `transcribed` item; click Mark reviewed; PATCH body **equals** `{ status: 'reviewed' }`; on success status chip shows "reviewed".
9. `409 on approve surfaces message` — MSW returns 409 `{ error: 'item not transcribed yet' }` for the approve PATCH; assert inline message "item hasn't been transcribed yet".
10. `link existing person` — pick a person + role author, submit; captured POST body **equals** `{ personId: <id>, role: 'author' }`; on success the new chip appears (people query invalidated → item refetched with the link).
11. `create person inline then link` — enter a name, submit create; POST `/api/people` body **equals** `{ name: '<name>' }`; then a link POST fires for the returned id as role `subject`.
12. `null transcription empty state` — item with `transcription_diplomatic === null` → "no text detected" + "start transcription" action; clicking it yields an editable empty textarea.

**TDD steps:**
- [ ] Write `Workspace.test.tsx`; add MSW handlers (GET item variants, PATCH capture, people link/create); run `cd web && npx vitest run src/routes/Workspace.test.tsx` → FAIL.
- [ ] Implement the components + route.
- [ ] Run the test → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): review workspace v1 — textareas, confidence banner, metadata, people, lifecycle`

**Acceptance criteria:**
- A reviewer can edit both transcriptions, title/description/date+precision, link/create people, Save (only changed fields), and approve; 409 and pending-disable paths behave exactly as specified; `ai_confidence` never PATCHed.

---

### Task 8: Minimal `/timeline` with the fuzzy-date → timeline-item translation unit

**Files:**
- Modify: `web/src/timeline/translate.ts` (add `toTimelineData` alongside `formatDateLabel`)
- Create: `web/src/timeline/translate.test.ts` additions (extend the file from Task 6) — pin as same file, new `describe('toTimelineData')`
- Create: `web/src/routes/Timeline.tsx`, `web/src/routes/Timeline.test.tsx`
- Create: `web/src/components/TimelineView.tsx` (thin vis-timeline React wrapper)
- Modify: `web/src/router.tsx`, `web/src/test/handlers.ts`

**Interfaces (produced — exact):**
```ts
import type { ItemSummary, Precision, Status } from '@shared/api.js';
export interface TimelineDatum {
  id: number;
  content: string;              // formatDateLabel + title
  start: string;                // date_start (ISO)
  end?: string;                 // date_end for ranges (month/year/decade)
  type: 'point' | 'range';      // exact -> point; month/year/decade -> range
  className: string;            // `precision-<p> status-<s>` (space-joined)
}
export function toTimelineData(items: ItemSummary[]): { data: TimelineDatum[]; undated: ItemSummary[] };
```

**Behavior (exact):**
- For each item:
  - `date_precision === 'unknown'` OR `date_start === null` → pushed to `undated` (never placed on the axis).
  - `exact` → `{ type:'point', start: date_start, className:'precision-exact status-<status>' }`.
  - `month`/`year`/`decade` → `{ type:'range', start: date_start, end: date_end ?? date_start, className:'precision-<p> status-<status>' }`.
  - `content` = `` `${formatDateLabel(date_start, precision)} — ${title ?? 'Untitled'}` ``.
- `TimelineView` renders a vis-timeline `Timeline` over `data` in an effect (create on mount, `setItems` on data change, destroy on unmount). Minimal styling this task — full precision CSS/tray/tooltips land in Stage 3.
- `Timeline` route: `useItems({})` → `toTimelineData` → `<TimelineView>` for `data`; renders the count of `undated` items (tray rendering itself is Stage 3, but show a minimal "N undated" note so the skeleton is honest).

**Test specs:**

`translate.test.ts` (new `describe('toTimelineData')`):
1. `exact -> point` — one exact item → `data[0]` `{ type:'point', start:'1943-05-12', className` includes `precision-exact` and `status-<s>` `}`, `undated` empty.
2. `year -> range` — year item → `{ type:'range', start:'1943-01-01', end:'1943-12-31', className` includes `precision-year` `}`.
3. `decade -> range` — decade item → `precision-decade`, range spanning the decade.
4. `unknown -> undated` — unknown-precision item → `data` empty, `undated` length 1.
5. `null date_start -> undated` — item with `date_start:null` but precision `year` → routed to `undated` (null start wins).
6. `content label` — `content` equals `"1943 — <title>"` for a year item (uses `formatDateLabel`).
7. `status token` — pending item → className contains `status-pending`.

`Timeline.test.tsx` (RTL + MSW):
8. `renders without crashing and shows undated count` — MSW returns 1 dated + 1 unknown item; assert the "1 undated" note; the `TimelineView` container is present. (vis-timeline DOM internals not asserted; the translation is the tested unit.)

**TDD steps:**
- [ ] Extend `translate.test.ts` with `toTimelineData` cases; write `Timeline.test.tsx`; run `cd web && npx vitest run src/timeline/translate.test.ts src/routes/Timeline.test.tsx` → FAIL.
- [ ] Implement `toTimelineData`, `TimelineView`, `Timeline` route.
- [ ] Run tests → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): timeline translation unit + minimal vis-timeline route`

**Acceptance criteria:**
- `toTimelineData` maps every precision correctly and routes unknown/null-start items to `undated`, fully unit-tested; the route renders at least one item's fuzzy span.

---

### Task 9: Skeleton verification against the real backend

**Files:**
- Create: `docs/superpowers/plans/verification/2026-07-08-frontend-skeleton-checklist.md` (a short executed checklist artifact) — this is the one intentional doc file this plan authorizes.

**Procedure (use the `verify` and `run` skills):**
- [ ] Start the backend: from repo root `npm run dev` (listens on :3271). Ensure at least one item exists (import a sample via `POST /api/import` or an existing `data/` DB) and, if an AI key is configured, run `POST /api/queue/process` once so an item is `transcribed` with `ai_confidence`.
- [ ] Start the web app: `cd web && npm run dev`; open the Vite URL in a real browser.
- [ ] Verify end to end and record pass/fail per step in the checklist file:
  1. Library lists items with thumbnails, status chips, media-type icons, honest date labels.
  2. Open an item → workspace shows the scan (file endpoint), confidence banner (overall + summary), both transcriptions behind the tab toggle, flagged spans listed.
  3. Edit title + date/precision + a transcription; Save; reload → changes persisted (only changed fields were sent — confirm via browser Network tab that the PATCH body carried no `ai_confidence`).
  4. Link an existing person and create-and-link a new person; chips update.
  5. On a `transcribed` item, Mark reviewed → status flips to `reviewed`; on a `pending` item the button is disabled with the reason.
  6. `/timeline` renders that item's fuzzy span at the correct position/precision; unknown items appear in the undated count.
- [ ] Fix any defects found (small follow-up commits) until every step passes.
- [ ] Commit: `docs: record frontend skeleton in-browser verification against live backend`

**Acceptance criteria:**
- The full skeleton flow (list → open → correct AI fields → link person → approve → timeline) works in a real browser against the live backend; checklist saved with all steps passing.

---

# Stage 2 — Review editor (CodeMirror 6 + flagged-span highlighting)

---

### Task 10: Pure span-matching / decoration-building module

**Files:**
- Create: `web/src/review/decorations.ts`, `web/src/review/decorations.test.ts`

**Interfaces (produced — exact):**
```ts
export interface SpanMatch {
  from: number;              // inclusive start offset in the text
  to: number;                // exclusive end offset
  kind: 'flagged' | 'marker';
  reason: string;            // flagged: the span's reason; marker: a description of the marker type
}
export function findFlaggedSpans(text: string, flaggedSpans: { text: string; reason: string }[]): SpanMatch[];
export function findUncertaintyMarkers(text: string): SpanMatch[];
export function buildDecorations(text: string, flaggedSpans: { text: string; reason: string }[]): SpanMatch[];
export function isSpanResolved(text: string, spanText: string): boolean; // !text.includes(spanText)
```

**Behavior (exact):**
- `findFlaggedSpans`: for each flagged span, find **all** non-overlapping occurrences of its `text` via successive `indexOf` (skip empty `text`); each occurrence → `SpanMatch{kind:'flagged', reason: span.reason}`. A span whose `text` is not present contributes no matches.
- `findUncertaintyMarkers`: regex `/\[illegible\]|\[\?\]|\[possibly[^\]]*\]/g`; each match → `SpanMatch{kind:'marker', reason}` where reason is: `[illegible]` → "illegible passage"; `[?]` → "uncertain word"; `[possibly …]` → "uncertain name".
- `buildDecorations`: returns `findFlaggedSpans(...)` concatenated with `findUncertaintyMarkers(...)`, sorted by `from` ascending then `to` ascending (stable). Overlaps are allowed (a marker may sit inside a flagged span) — CodeMirror layers them in Task 11.
- `isSpanResolved(text, spanText)`: `true` when `spanText` no longer appears in `text` (used by the sidebar to strike-through resolved flags).

**Test specs (`decorations.test.ts`):**
1. `matches all occurrences` — text with the flagged substring twice → two `flagged` matches at the correct offsets.
2. `no match when absent` — flagged text not present → zero matches; `isSpanResolved` returns `true` for it.
3. `marker regex` — text `"the [illegible] farm [?] near [possibly Smith]"` → three `marker` matches with reasons "illegible passage", "uncertain word", "uncertain name" and correct offsets.
4. `buildDecorations merges and sorts` — flagged span overlapping a marker → both present, sorted by `from`.
5. `empty flaggedSpans` — `buildDecorations(text, [])` returns only marker matches.
6. `empty span text ignored` — flagged span with `text: ''` → produces no matches (no infinite loop).
7. `resolved after edit` — original text had the span; edited text with it removed → `isSpanResolved` `true`; still present → `false`.

**TDD steps:**
- [ ] Write `decorations.test.ts`; run `cd web && npx vitest run src/review/decorations.test.ts` → FAIL.
- [ ] Implement `decorations.ts`.
- [ ] Run test → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): pure flagged-span/marker decoration module`

**Acceptance criteria:**
- All occurrences matched, markers detected via regex, merge sorted, resolved detection correct, no infinite loops on empty span text — all unit-tested.

---

### Task 11: CodeMirror 6 editor + flags sidebar (replaces the textareas)

**Files:**
- Create: `web/src/review/TranscriptionEditor.tsx`, `web/src/review/TranscriptionEditor.test.tsx`
- Create: `web/src/review/FlagsSidebar.tsx`
- Modify: `web/src/routes/Workspace.tsx` (swap textareas → `TranscriptionEditor`; keep the diplomatic/normalized tab toggle, null empty state, and the same Save wiring; `FlagsSidebar` replaces/augments the Task 7 `FlaggedSpansList`)
- Modify: `web/src/routes/Workspace.test.tsx` (adjust selectors from `<textarea>` to the editor; keep all lifecycle assertions from Task 7 green)

**Interfaces (produced — exact):**
```ts
interface TranscriptionEditorProps {
  value: string;
  onChange: (next: string) => void;
  flaggedSpans: { text: string; reason: string }[]; // from ai_confidence (diplomatic tab only)
}
```
- Consumes `buildDecorations` from Task 10.

**Behavior (exact):**
- CodeMirror 6 (`@codemirror/state` + `@codemirror/view`), plain-text (no language), preserves line breaks. A controlled editor: external `value` change updates the doc; user edits call `onChange` with the new doc string.
- Decorations built from `buildDecorations(value, flaggedSpans)`: `flagged` matches get a mark decoration class `cm-flagged` with a hover tooltip = the `reason`; `marker` matches get class `cm-uncertain` (styled distinctly). Recomputed on every doc change (via a `StateField` or a view plugin reading the current doc).
- Flagged spans are applied on the **diplomatic** tab only (they quote diplomatic text); the normalized tab shows an editor without flagged decorations (markers may still be absent there).
- `FlagsSidebar`: lists `flaggedSpans`; clicking one scrolls the editor to the first occurrence and selects it; a span whose `text` is no longer present (per `isSpanResolved` against current diplomatic value) renders **struck-through** ("resolved").
- Null transcription empty state and "start transcription" action preserved from Task 7.

**Test specs (`TranscriptionEditor.test.tsx` + Workspace adjustments):**
1. `renders flagged text with class` — mount editor with a value containing a flagged span; assert a DOM node with class `cm-flagged` wraps the span text.
2. `renders uncertainty marker with class` — value containing `[illegible]` → a `cm-uncertain` node present.
3. `edit calls onChange` — type into the editor → `onChange` fires with the updated string.
4. `sidebar strike-through when resolved` — value no longer containing a listed span → that sidebar entry has the resolved/struck style; still-present span not struck.
5. `sidebar click selects span` — click a sidebar entry → editor selection covers the span (assert selection offsets or a scrolled-into-view marker).
6. Workspace regression: tests 3–9 from Task 7 (save-only-changed-fields, approve, 409, disabled-on-pending) remain green with the editor swapped in.

**TDD steps:**
- [ ] Update/add tests; run `cd web && npx vitest run src/review/TranscriptionEditor.test.tsx src/routes/Workspace.test.tsx` → FAIL for new cases.
- [ ] Implement `TranscriptionEditor` + `FlagsSidebar`; wire into Workspace.
- [ ] Run tests → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): CodeMirror transcription editor with flagged-span/marker decorations + flags sidebar`

**Acceptance criteria:**
- Flagged spans and uncertainty markers are highlighted inline with tooltips; the sidebar links to spans and strikes through resolved ones; all Task 7 lifecycle behavior still passes.

---

# Stage 3 — Full timeline

---

### Task 12: Precision visual encoding, labels, status tints, and the Undated tray

**Files:**
- Create: `web/src/timeline/timeline.css` (precision + status classes)
- Modify: `web/src/components/TimelineView.tsx` (attach the CSS; ensure classNames from `toTimelineData` are applied to vis-timeline items)
- Create: `web/src/components/UndatedTray.tsx`, `web/src/components/UndatedTray.test.tsx`
- Modify: `web/src/routes/Timeline.tsx` (render the tray below the axis), `web/src/routes/Timeline.test.tsx`

**Behavior (exact):**
- CSS per precision (matching classNames produced in Task 8):
  - `.precision-exact` → point marker.
  - `.precision-month`, `.precision-year` → range bar, solid center, **gradient-faded left/right edges** (CSS gradient mask).
  - `.precision-decade` → **diagonal-hatched translucent bar** (repeating-linear-gradient).
  - Item text labels remain the honest `formatDateLabel` strings ("May 12, 1943" / "May 1943" / "1943" / "c. 1940s").
- **Status tints**: `.status-pending` / `.status-transcribed` / `.status-reviewed` add a distinguishing tint so unreviewed work is spottable (applied together with the precision class).
- **UndatedTray**: renders the `undated` items (from `toTimelineData`) as a labeled tray below the axis; each entry is clickable → navigates to `/items/:id`. Shows nothing (or a subtle empty note) when there are no undated items.

**Test specs:**

`UndatedTray.test.tsx`:
1. `renders undated entries` — given 2 undated `ItemSummary` → 2 clickable entries with titles.
2. `click navigates to workspace` — click an entry → route `/items/:id`.
3. `empty tray` — empty array → renders an empty/absent state (no entries).

`Timeline.test.tsx` (extend):
4. `unknown items appear in tray not axis` — MSW returns 1 year item + 1 unknown item → tray shows the unknown item; `toTimelineData().data` (asserted via the rendered axis container item count or a test hook) excludes it.

(vis-timeline internal DOM/CSS is verified in the Stage-3 in-browser check within Task 21's polish/verify or an ad-hoc `verify` run; class application is asserted at the `toTimelineData` boundary.)

**TDD steps:**
- [ ] Write `UndatedTray.test.tsx` + Timeline extensions; run `cd web && npx vitest run src/components/UndatedTray.test.tsx src/routes/Timeline.test.tsx` → FAIL.
- [ ] Implement CSS, tray, and route wiring.
- [ ] Run tests → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): timeline precision styles, status tints, and undated tray`

**Acceptance criteria:**
- Each precision is visually distinct (point / faded range / hatched), labels stay honest, status tints applied, unknown items live in a clickable Undated tray.

---

### Task 13: Timeline hover tooltip + click-to-workspace navigation

**Files:**
- Modify: `web/src/components/TimelineView.tsx` (tooltip content + select/click handler)
- Create/Modify: `web/src/timeline/tooltip.ts`, `web/src/timeline/tooltip.test.ts` (pure tooltip-HTML/content builder)
- Modify: `web/src/routes/Timeline.test.tsx`

**Interfaces (produced — exact):**
```ts
import type { ItemSummary } from '@shared/api.js';
export function buildTimelineTooltip(item: ItemSummary): string; // HTML string for vis-timeline item `title`
```

**Behavior (exact):**
- `buildTimelineTooltip` returns HTML containing: the item title (or "Untitled"), a thumbnail `<img src="/api/items/:id/thumbnail">`, the precision label, and the full range (`date_start` – `date_end`, or the single date for `exact`). Escape the title to avoid HTML injection.
- `TimelineView` passes each datum a `title` = `buildTimelineTooltip(item)` and registers vis-timeline's `select`/`click` event → `navigate('/items/' + id)`.

**Test specs:**

`tooltip.test.ts`:
1. `includes title, thumbnail, precision, range` — for a year item, the string contains the title, `src="/api/items/<id>/thumbnail"`, "1943", and the range `1943-01-01`–`1943-12-31`.
2. `exact shows single date` — exact item → range shows the single date, not a span.
3. `escapes title` — title containing `<b>` → escaped in output (no raw `<b>`).
4. `untitled fallback` — null title → "Untitled".

`Timeline.test.tsx` (extend):
5. `click axis item navigates` — simulate a vis-timeline select event (via the wired handler) → route `/items/:id`. (Handler unit-invoked if simulating vis events is impractical in jsdom.)

**TDD steps:**
- [ ] Write `tooltip.test.ts` + Timeline nav test; run `cd web && npx vitest run src/timeline/tooltip.test.ts src/routes/Timeline.test.tsx` → FAIL.
- [ ] Implement `buildTimelineTooltip` + wire events.
- [ ] Run tests → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): timeline tooltips and click-to-workspace navigation`

**Acceptance criteria:**
- Hovering an axis item shows title + thumbnail + precision + full range; clicking opens the workspace; tooltip builder is pure and unit-tested and escapes titles.

---

# Stage 4 — Ingest (upload, import screen, queue UI)

---

### Task 14: Backend `POST /api/upload` (multipart staging → import → cleanup)

**Files:**
- Modify: `src/server.ts` (register `@fastify/multipart`; add the route; add `stagingDir` to `ServerDeps`)
- Modify: `src/main.ts` (create + pass `stagingDir = join(dataDir, 'staging')`)
- Modify: `package.json` (add `@fastify/multipart`)
- Create: `tests/upload.test.ts`

**Interfaces:**
- `ServerDeps` gains `stagingDir: string`. All existing `buildServer({...})` call sites (tests + main) must pass it — pin: existing backend tests that construct `buildServer` add `stagingDir: '/tmp/na'` (or an OS temp dir) where needed; only `tests/upload.test.ts` exercises it with a real dir.
- Route `POST /api/upload`:
  - Consumes `multipart/form-data`: one or more file parts + one text field `mediaType` (∈ `MediaType`).
  - For each file part: write it to a unique path under `stagingDir` (create dir if missing), call the existing `importFile(db, stagedPath, { archiveDir, cacheDir, mediaType })`, then delete the staged copy. Push `{ path: <original filename>, itemId, duplicate }` on success or `{ path: <original filename>, error: <message> }` on failure (per-file, non-throwing).
  - 400 `{ error: 'mediaType must be one of ...' }` when `mediaType` is missing/invalid.
  - Returns the per-file array (same shape as `/api/import`, but `path` = original filename).

**Test specs (`tests/upload.test.ts`, in-memory DB + real temp `stagingDir`/`archiveDir`/`cacheDir`; use the `form-data` dev dependency to build the multipart payload for `app.inject`):**
1. `uploads a file and imports it` — POST one real small JPEG + `mediaType=photo` → 200, result `[{ path:'<name>.jpg', itemId:<n>, duplicate:false }]`; a row exists in `items`; the staged file no longer exists.
2. `duplicate on second identical upload` — upload same bytes twice → second result `duplicate: true` with the same `itemId`.
3. `multiple files in one request` — two file parts → two results in order.
4. `invalid mediaType 400` — `mediaType=bogus` → 400.
5. `per-file error is non-blocking` — one good file + one that triggers an import error (e.g. a zero-byte/corrupt image causing thumbnailing failure for a `photo`) → results contain one success and one `{ path, error }`; the request still returns 200.
6. `staging cleaned up` — after any upload, `stagingDir` contains no leftover files.

**TDD steps:**
- [ ] `npm install @fastify/multipart` and (dev) `form-data`.
- [ ] Write `tests/upload.test.ts`; run `npx vitest run tests/upload.test.ts` → FAIL.
- [ ] Add `stagingDir` to `ServerDeps`; register multipart; implement the route; update `main.ts` and any `buildServer` call sites.
- [ ] Run `npx vitest run tests/upload.test.ts` → PASS; `npm test` → all green (update other server tests to pass `stagingDir` if the type now requires it); `npm run typecheck` → clean.
- [ ] Commit: `feat: POST /api/upload multipart staging endpoint`

**Acceptance criteria:**
- Uploaded bytes are staged, imported via the existing importer, and the staged copy removed; duplicates and per-file errors reported without failing the request; existing suite green.

---

### Task 15: `/import` screen — Uppy Dashboard + media-type selector + duplicate feedback

**Files:**
- Create: `web/src/routes/Import.tsx`, `web/src/routes/Import.test.tsx`
- Create: `web/src/import/summarize.ts`, `web/src/import/summarize.test.ts` (pure results→summary)
- Modify: `web/src/router.tsx`, `web/src/test/handlers.ts`

**Interfaces (produced — exact):**
```ts
import type { ImportResult } from '@shared/api.js';
export interface ImportSummary { imported: number; duplicates: number; failed: number; line: string; }
export function summarizeImport(results: ImportResult[]): ImportSummary;
```

**Behavior (exact):**
- Uppy 5 `Dashboard` (`@uppy/react`) with `XHRUpload` plugin posting to `/api/upload` (endpoint = `` `${API_BASE}/api/upload` ``), field name for files as required by the backend part parsing. A **media-type selector** (`<select>` over `MediaType`) sets the `mediaType` form field sent with the upload (Uppy `meta` / `XHRUpload` `formData: true`).
- The backend responds with the per-file `ImportResult[]`; the screen parses it with `ImportResultSchema.array()` and renders per file:
  - imported → link to `/items/:itemId`.
  - duplicate → an "already in archive" badge linking to the existing `/items/:itemId`.
  - failed → the `error` text (non-blocking).
- **Inform, don't ask** (no skip/replace/keep-both).
- `summarizeImport` builds the summary line: `` `${imported} imported, ${duplicates} already in archive, ${failed} failed` `` where `imported` = results with `duplicate === false`, `duplicates` = `duplicate === true`, `failed` = results with an `error`.

**Test specs:**

`summarize.test.ts`:
1. `mixed results` — `[{path,itemId,duplicate:false},{path,itemId,duplicate:true},{path,error:'x'}]` → `{ imported:1, duplicates:1, failed:1, line:'1 imported, 1 already in archive, 1 failed' }`.
2. `all imported` — three fresh → `"3 imported, 0 already in archive, 0 failed"`.
3. `empty` — `[]` → `"0 imported, 0 already in archive, 0 failed"`.

`Import.test.tsx` (RTL; Uppy upload simulated by feeding a known `ImportResult[]` through the results-rendering component — do not drive the real XHR):
4. `renders per-file outcomes` — given results with one imported, one duplicate, one failed → an imported link to `/items/<id>`, an "already in archive" badge linking `/items/<id>`, and the error text.
5. `renders summary line` — the summary matches `summarizeImport`.
6. `media-type selector present` — a selector listing all six media types exists.

**TDD steps:**
- [ ] Write `summarize.test.ts` + `Import.test.tsx`; run `cd web && npx vitest run src/import` → FAIL.
- [ ] Implement `summarizeImport`, the results view, and the Uppy Dashboard wiring.
- [ ] Run tests → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): Uppy import screen with media-type selector and duplicate feedback`

**Acceptance criteria:**
- Files upload to `/api/upload` with a chosen media type; each file's outcome (imported / already-in-archive / failed) is shown with links, plus an accurate summary line; no skip/replace prompts.

---

### Task 16: Queue processing UI — mutation, live polling, 503 disabled state

**Files:**
- Modify: `web/src/api/hooks.ts` (add `useProcessQueue`), `web/src/api/hooks.test.tsx`
- Create: `web/src/components/ProcessQueueButton.tsx`, `web/src/components/ProcessQueueButton.test.tsx`
- Modify: `web/src/components/AppShell.tsx` (mount the button in the header actions), `web/src/api/hooks.ts` items-query polling
- Modify: `web/src/test/handlers.ts`

**Interfaces (produced — exact):**
```ts
import type { QueueResult } from '@shared/api.js';
export function useProcessQueue(): UseMutationResult<QueueResult, ApiError, void>;
```

**Behavior (exact):**
- `useProcessQueue` → `POST /api/queue/process`, parse `QueueResultSchema`. On success invalidate `['items']` and `['item']` queries. A **503** surfaces as an `ApiError` with `.status === 503` and `.serverMessage` naming the missing env var.
- **Live polling**: while the mutation `isPending`, `useItems` queries poll with a **function-form `refetchInterval`** returning `2000`, and `false` otherwise, so statuses tick over live and stop when the pass settles. Pin implementation: a small module-level/store flag (Zustand UI store `useQueueStore` with `processing: boolean`) that `ProcessQueueButton` toggles around the mutation, and `useItems` reads to decide its `refetchInterval`. (Zustand holds only this UI flag — never server data.)
- `ProcessQueueButton`:
  - Idle → "Process queue"; click runs the mutation; while pending → spinner + "Processing…" and the live ticking is active.
  - On 503 → a **persistent disabled** state: button disabled, label/explanation "AI not configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY" (uses `.serverMessage` when present). This disabled state persists (does not auto-clear on a timer).
  - On success → brief "Processed N, failed M" note.

**Test specs:**

`hooks.test.tsx` (extend):
1. `useProcessQueue posts and parses` — MSW returns `{ processed:2, failed:0 }` → mutation `data` equals it; `['items']` invalidation observed (a pending items query refetches).
2. `503 yields ApiError` — MSW returns 503 `{ error: 'AI not configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY' }` → mutation error is `ApiError`, `.status === 503`, `.serverMessage` equals that message.

`ProcessQueueButton.test.tsx`:
3. `click triggers processing state` — click → spinner/"Processing…" shown while pending.
4. `503 shows persistent disabled state` — MSW 503 → after the click the button is disabled and the "AI not configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY" text is shown and remains (not cleared).
5. `success shows processed note` — MSW success → "Processed 2, failed 0" note.
6. `polling activates during processing` — assert `useItems` refetches at least once more while processing (spy the items handler call count increases while the mutation is pending). (May assert the store flag flips and the `refetchInterval` function returns 2000.)

**TDD steps:**
- [ ] Write the hook + button tests; run `cd web && npx vitest run src/api/hooks.test.tsx src/components/ProcessQueueButton.test.tsx` → FAIL.
- [ ] Implement `useProcessQueue`, the Zustand `useQueueStore` flag, `useItems` polling, and `ProcessQueueButton`; mount in `AppShell`.
- [ ] Run tests → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): queue processing button with live polling and 503 disabled state`

**Acceptance criteria:**
- Processing the queue polls item statuses live at 2s and stops when settled; 503 yields a persistent disabled state naming the env var; success reports counts.

---

# Stage 5 — Completeness & polish

---

### Task 17: `/people` screen (list + create; person click → `/?personId=`)

**Files:**
- Create: `web/src/routes/People.tsx`, `web/src/routes/People.test.tsx`
- Modify: `web/src/router.tsx`, `web/src/test/handlers.ts`

**Interfaces:** Consumes `usePeople`, `useCreatePerson`, type `Person`.

**Behavior:**
- Lists all people (name; notes if present). A create form (name required, optional notes) → `useCreatePerson`; on success the list refreshes (people invalidation).
- Clicking a person navigates to `/?personId=<id>` (Library filters to that person).

**Test specs (`People.test.tsx`, RTL + MSW):**
1. `lists people` — MSW returns 2 people → both names render.
2. `create person` — submit name "Ada" → POST `/api/people` body **equals** `{ name: 'Ada' }`; list refreshes to include "Ada".
3. `create with notes` — name + notes → body **equals** `{ name:'Ada', notes:'<n>' }`.
4. `person click navigates to filtered library` — click a person → route `/?personId=<id>`.

**TDD steps:**
- [ ] Write `People.test.tsx`; run `cd web && npx vitest run src/routes/People.test.tsx` → FAIL.
- [ ] Implement `People` route; wire router.
- [ ] Run test → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): people screen with create and filtered-library navigation`

**Acceptance criteria:**
- People list + create work; creating sends only `{ name, notes? }`; clicking a person filters the library.

---

### Task 18: `ai_names` suggestion chips (one-click create + link as subject)

**Files:**
- Create: `web/src/review/aiNames.ts`, `web/src/review/aiNames.test.ts` (pure parse + filter)
- Modify: `web/src/components/PeoplePanel.tsx` (render suggestion chips), `web/src/routes/Workspace.test.tsx`

**Interfaces (produced — exact):**
```ts
import type { PersonRef } from '@shared/api.js';
export function parseAiNames(aiNames: string | null): string[]; // JSON.parse -> string[]; [] on null/invalid
export function suggestibleNames(aiNames: string | null, linked: PersonRef[]): string[]; // parsed minus names already linked (case-insensitive)
```

**Behavior (exact):**
- `parseAiNames`: `JSON.parse` the string; return it if it is an array of strings, else `[]`; `null`/parse error → `[]`.
- `suggestibleNames`: `parseAiNames` minus any name already present in `linked` (case-insensitive, trimmed compare); de-duplicate.
- `PeoplePanel` renders each suggestible name as a chip; clicking it creates the person (`useCreatePerson` with `{ name }`) then links the returned id as role `subject` (`useLinkPerson`). The chip disappears once linked (list refetches).

**Test specs:**

`aiNames.test.ts`:
1. `parses JSON array` — `'["Mabel","Earl"]'` → `['Mabel','Earl']`.
2. `null/invalid → []` — `null` → `[]`; `'not json'` → `[]`; `'{"a":1}'` (not an array) → `[]`.
3. `filters already-linked (case-insensitive)` — names `['Mabel','Earl']`, linked `[{name:'mabel',...}]` → `['Earl']`.
4. `dedupes` — `'["Ann","Ann"]'` → `['Ann']`.

`Workspace.test.tsx` (extend):
5. `chip creates + links as subject` — item with `ai_names='["Mabel"]'` and no linked people → a "Mabel" suggestion chip; click → POST `/api/people` body `{ name:'Mabel' }` then POST `/api/items/:id/people` body `{ personId:<id>, role:'subject' }`.
6. `already-linked name not suggested` — `ai_names='["Mabel"]'` and Mabel already linked → no chip.

**TDD steps:**
- [ ] Write `aiNames.test.ts` + Workspace extensions; run `cd web && npx vitest run src/review/aiNames.test.ts src/routes/Workspace.test.tsx` → FAIL.
- [ ] Implement `aiNames.ts`; render chips in `PeoplePanel`.
- [ ] Run tests → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): ai_names suggestion chips (create + link as subject)`

**Acceptance criteria:**
- `ai_names` JSON parsed safely; suggestions exclude already-linked names; one click creates the person and links as `subject`.

---

### Task 19: Media viewers for audio / video / pdf

**Files:**
- Modify: `web/src/components/MediaViewer.tsx`, `web/src/components/MediaViewer.test.tsx`

**Behavior (exact):**
- `MediaViewer` chooses by `item.media_type` (and/or file extension), all pointing at `/api/items/:id/file`:
  - `photo`/`letter`/`article` (image) → `<img>` with zoom/pan (existing).
  - `audio` → `<audio controls src=...>`.
  - `video` → `<video controls src=...>`.
  - `pdf` → `<iframe src=...>` (or `<embed>`), inline.
- Unknown/unsupported → a download link to the file endpoint.

**Test specs (`MediaViewer.test.tsx`):**
1. `audio → audio element` — `media_type:'audio'` → an `<audio>` with `src` ending `/api/items/<id>/file`.
2. `video → video element` — `media_type:'video'` → a `<video>` with the file src.
3. `pdf → iframe` — `media_type:'pdf'` → an `<iframe>`/`<embed>` with the file src.
4. `image → img` — `media_type:'photo'` → an `<img>` with the file src.

**TDD steps:**
- [ ] Write `MediaViewer.test.tsx`; run `cd web && npx vitest run src/components/MediaViewer.test.tsx` → FAIL.
- [ ] Implement media-type branching.
- [ ] Run test → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): audio/video/pdf media viewers`

**Acceptance criteria:**
- Each media type renders an appropriate viewer pointed at the file endpoint.

---

### Task 20: Error boundaries + backend-down full-page state

**Files:**
- Create: `web/src/components/RouteErrorBoundary.tsx`, `web/src/components/BackendDown.tsx`, `web/src/components/RouteErrorBoundary.test.tsx`
- Modify: `web/src/router.tsx` (attach `errorElement`/boundaries per route), route components (surface per-mutation inline errors — already done for approve/queue; confirm consistency)

**Behavior (exact):**
- Route-level error boundary with a retry action (re-run the failed query). A zod parse failure or non-2xx `ApiError` from a query renders inside the boundary (never a silently-wrong render).
- **Backend-down** detection: a fetch rejection (network error, backend not on :3271) from any top-level query → a full-page "can't reach the KinTrace backend on :3271" state with a retry button. Pin: `apiFetch` lets `TypeError` (fetch rejection) propagate; a top-level boundary distinguishes it from `ApiError` (which has a `.status`) and renders `BackendDown` for the former.
- Per-mutation inline errors (409 approve, 503 queue, per-file upload) remain next to their controls (already implemented in Tasks 7/15/16) — this task only adds the query/route boundaries and the backend-down page.

**Test specs (`RouteErrorBoundary.test.tsx`, RTL + MSW):**
1. `query ApiError renders boundary with retry` — MSW returns 500 for `GET /api/items`; Library within the boundary shows an error UI + a retry control; clicking retry refetches (MSW now returns 200) → list renders.
2. `zod parse failure renders boundary` — MSW returns a malformed body → boundary shown (not a broken render).
3. `fetch rejection renders BackendDown` — MSW handler responds with a network error (`res.networkError()` / thrown) → the full-page "can't reach the KinTrace backend on :3271" state with retry.

**TDD steps:**
- [ ] Write `RouteErrorBoundary.test.tsx`; run `cd web && npx vitest run src/components/RouteErrorBoundary.test.tsx` → FAIL.
- [ ] Implement boundaries + `BackendDown`; attach in router.
- [ ] Run test → PASS; `cd web && npm run typecheck` → clean.
- [ ] Commit: `feat(web): route error boundaries and backend-down full-page state`

**Acceptance criteria:**
- Query/parse errors surface in a retryable boundary; a dead backend shows the dedicated full-page state; no silently-wrong renders.

---

### Task 21: Visual polish — "the archivist's desk" design language

**Files:**
- Create: `web/src/styles/theme.css` (design tokens), `web/src/styles/global.css`
- Modify: components/routes to consume tokens; `web/index.html` (self-hosted Fraunces font `@font-face` + a quiet grotesque for UI)
- Create: `docs/superpowers/plans/verification/2026-07-08-frontend-final-checklist.md` (executed in-browser checklist)

**Required first step:** the implementer MUST load the **frontend-design** skill before writing any styles, and execute the aesthetic per that skill.

**Design language (from spec):**
- Warm paper/ivory surfaces, ink-charcoal text, one accent (deep oxblood/sepia).
- **Fraunces** (OFL) self-hosted as the serif display face for titles; a quiet grotesque for UI text.
- Scans presented like **prints on a desk**: subtle shadow, generous margins.
- Restrained texture, no skeuomorphic kitsch; modern grid + fast interactions underneath.
- Dark mode deferred (do not implement).

**Behavior:**
- Apply tokens across Library cards, workspace panes, timeline, import, people. Keep all existing behavior and tests green (this is a visual pass — prefer additive CSS + className changes that don't break test selectors; where a selector must change, update the test).

**Test/verification specs:**
- All existing web tests remain green after restyling (`cd web && npm run test`).
- In-browser verification (verify/run skills) recorded in the final checklist: fonts load (no CDN — self-hosted, CSP-safe), Library/workspace/timeline/import/people all render the intended aesthetic, scans read as "prints on a desk", contrast is legible, interactions stay fast.

**TDD steps:**
- [ ] Load the `frontend-design` skill; define `theme.css` tokens + `global.css`; self-host Fraunces.
- [ ] Restyle components; run `cd web && npm run test` → all green (update selectors only where necessary); `cd web && npm run typecheck` → clean.
- [ ] Run the app (`npm run dev` at root + `cd web && npm run dev`), verify the aesthetic in-browser, record the checklist.
- [ ] Commit: `feat(web): archivist's-desk visual design pass`

**Acceptance criteria:**
- The app presents the committed "archivist's desk" aesthetic (Fraunces titles, warm paper, oxblood/sepia accent, prints-on-a-desk scans), self-hosted fonts, all tests green, verified in-browser.

---

# Final review

### Task 22: Whole-branch final review (Opus 4.8)

- [ ] Dispatch a whole-branch review on **Opus 4.8** covering the full diff of `web/`, `shared/`, and the backend additions. Verify: every spec section is implemented; TypeScript strict + ESM throughout; all constraints honored (open-source only, MSW/injected-fake tests never hit a network, `ai_confidence` never PATCHed, status monotonic, base-URL/proxy config, archive originals untouched); shared contract is the single source of truth with no drift; naming/types consistent across tasks; no placeholders.
- [ ] Address any blocking findings via follow-up green-cycle commits (implementers on `model: claude-fable-5`, re-review on Opus 4.8).
- [ ] Run the full backend suite (`npm test`, `npm run typecheck` at root) and the full web suite (`cd web && npm run test && npm run typecheck`) — all green.

**Acceptance criteria:**
- Whole-branch review passes on Opus 4.8; both suites green; every spec section maps to shipped, tested code.

> **PR creation is handled by the `superpowers:finishing-a-development-branch` skill, not this plan.** Do not open a PR from within a task.

---

## Self-review notes (spec → task coverage)

- Goal / stack / model roles / global constraints → header + Global Constraints + Model roles.
- `shared/api.ts` + `shared/dates.ts` extraction, ConfidenceSchema relocation, wire-shape pins → Tasks 1–2.
- `GET .../thumbnail`, `GET .../file` → Task 3.
- `POST /api/upload` → Task 14.
- Web scaffold / data layer / library / workspace / minimal timeline / skeleton verify → Tasks 4–9 (Stage 1).
- CodeMirror editor + decorations + flags sidebar + null empty state → Tasks 10–11 (Stage 2).
- Full timeline (precision styles, tray, tints, tooltips, navigation) → Tasks 12–13 (Stage 3).
- Import screen + duplicate feedback + queue UI/polling/503 → Tasks 15–16 (Stage 4).
- People screen, `ai_names` chips, audio/video/pdf viewers, error boundaries/backend-down, visual polish → Tasks 17–21 (Stage 5).
- Final whole-branch review → Task 22.

Every stage ends shippable (typecheck clean, tests green, committed); the skeleton is verified in-browser against the real backend (Task 9) before Stage 2.
