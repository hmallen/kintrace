# HTR Ingestion Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two-pass HTR transcription (draft → verify-with-confidence) on OpenAI vision by default (Claude switchable), producing diplomatic + normalized transcriptions with mandatory uncertainty markers, behind a pluggable `TranscriptionEngine` seam.

**Architecture:** `VisionClient` (provider seam, unchanged) gets a second implementation (OpenAI Responses API); a new `TranscriptionEngine` layer composes two prompt/validate passes; queue/server/main depend on the engine, never a raw client. DB swaps the single `transcription` column for `transcription_diplomatic` / `transcription_normalized` + `ai_confidence` JSON.

**Tech Stack:** TypeScript strict ESM, Fastify, better-sqlite3, zod, vitest, `openai` + `@anthropic-ai/sdk`.

**Spec:** `docs/superpowers/specs/2026-07-08-htr-ingestion-design.md` — read it first; it is the authority on shapes and behavior.

## Global Constraints

- ESM + TypeScript strict; `npm test` and `npm run typecheck` green at the end of every task.
- All AI responses zod-validated before any DB write.
- Status lifecycle exactly `pending → transcribed → reviewed`; per-item failure records `ai_error`, item stays `pending`; a failed second pass never promotes.
- Tests never call a real API — fake through the `VisionClient` seam (or the injectable OpenAI SDK seam). Test output pristine (no stray console noise).
- No migration code — edit `CREATE TABLE` in `src/db.ts` in place; a fresh DB is fine.
- The build must compile and tests pass after EACH task (the old single-field path survives until Task 3 removes it).
- Commit after every green test cycle. Match existing code style (see `src/ai/transcriber.ts` for prompt/parse idioms).
- **This plan is contract-level by design**: it pins files, exact signatures, schemas, behaviors, and test expectations — the implementer writes the actual code and tests to these contracts.

---

### Task 1: Provider layer — OpenAI client, Anthropic move, provider selection

**Files:**
- Create: `src/ai/providers.ts`
- Create: `tests/providers.test.ts`
- Modify: `src/ai/transcriber.ts` (delete `createAnthropicVisionClient` + the `@anthropic-ai/sdk` import; `VisionClient` stays here)
- Modify: `src/main.ts` (only the import path of `createAnthropicVisionClient` — behavior unchanged in this task)
- Modify: `package.json` (add `openai` dependency)

**Interfaces:**
- Consumes: `VisionClient` from `src/ai/transcriber.ts` (unchanged: `analyzeImages(images: Buffer[], prompt: string): Promise<string>`).
- Produces (later tasks rely on these exact names):
  - `createAnthropicVisionClient(apiKey: string): VisionClient` — moved verbatim from `transcriber.ts`, except `max_tokens` raised to `8192` (dual transcriptions + confidence roughly double output).
  - `createOpenAIVisionClient(apiKey: string, opts?: { model?: string; sdk?: OpenAiResponsesLike }): VisionClient`
  - `OpenAiResponsesLike` — a minimal interface WE define (do not export OpenAI SDK types): just the `responses.create(...)` surface the client calls, returning something exposing the response text. This is the test seam.
  - `resolveProvider(env: Record<string, string | undefined>): ProviderChoice` where
    `type ProviderChoice = { ok: true; provider: 'openai' | 'anthropic'; apiKey: string } | { ok: false; message: string }`

**OpenAI request contract** (verified against live OpenAI docs 2026-07-08 — the Responses API is current):
- `sdk.responses.create({ model, max_output_tokens: 8192, input: [{ role: 'user', content: [ ...one { type: 'input_image', image_url: 'data:image/jpeg;base64,<b64>' } per image, then { type: 'input_text', text: prompt } ] }] })`
- Response text read from the SDK response's aggregate `output_text`.
- Default model `'gpt-5.5'` (current flagship), overridden by `opts.model` when provided.
- If the installed `openai` SDK's TypeScript types disagree on a parameter name (e.g. the output-token cap), **the SDK types win** — adjust and note it in the commit message. Do not invent parameters.
- Real SDK instance is constructed only when `opts.sdk` is absent; tests always pass a fake.

**`resolveProvider` behavior (exact):**
- `TRANSCRIBE_PROVIDER` unset or `'openai'` → provider `openai`, key from `OPENAI_API_KEY`; missing key → `{ ok: false, message: 'AI transcription disabled: TRANSCRIBE_PROVIDER=openai but OPENAI_API_KEY is not set' }`.
- `'anthropic'` → key from `ANTHROPIC_API_KEY`; missing key → same message shape naming `ANTHROPIC_API_KEY`.
- Any other value → `{ ok: false, message: 'AI transcription disabled: unknown TRANSCRIBE_PROVIDER "<value>" (use openai or anthropic)' }`. Never throw.

**Test expectations (`tests/providers.test.ts`):**
- OpenAI client, given a fake `sdk` that records the request and returns a canned response: sends exactly one user message whose content is N `input_image` parts (each `image_url` starting `data:image/jpeg;base64,`, payload = the buffer's base64) followed by one `input_text` part with the prompt; `model` is `'gpt-5.5'` by default and the override when `opts.model` given; resolves to the fake's `output_text` string.
- `resolveProvider`: all five branches above (default→openai, explicit openai, explicit anthropic, each missing-key message names the right env var, unknown provider message). Assert on exact `message` strings.
- Existing suites still green (Anthropic move is import-path only for `main.ts`).

- [ ] **Step 1:** `npm install openai` (dependency lands in `package.json`).
- [ ] **Step 2:** Write `tests/providers.test.ts` covering the expectations above; run `npx vitest run tests/providers.test.ts` — expect FAIL (module doesn't exist).
- [ ] **Step 3:** Implement `src/ai/providers.ts` to the contracts; move the Anthropic factory out of `transcriber.ts`; fix the `main.ts` import.
- [ ] **Step 4:** `npx vitest run tests/providers.test.ts` → PASS; `npm test` → all green; `npm run typecheck` → clean.
- [ ] **Step 5:** Commit: `feat: add OpenAI vision client and provider selection behind VisionClient seam`

---

### Task 2: Two-pass transcriber + TranscriptionEngine (additive — old path still compiles)

**Files:**
- Modify: `src/ai/transcriber.ts` (add new schemas/prompts/pass functions; KEEP `transcribeItem` + `SuggestionSchema` untouched for now so `queue.ts` still compiles — Task 3 deletes them)
- Create: `src/ai/engine.ts`
- Create: `tests/engine.test.ts`
- Modify: `tests/transcriber.test.ts` (add tests for the new pass functions; leave old `transcribeItem` tests in place — Task 3 removes them)

**Interfaces:**
- Consumes: `VisionClient`; existing JSON-extraction helpers in `transcriber.ts` (reuse `extractJsonObject` — do not duplicate the brace-walking logic).
- Produces (exact, relied on by Tasks 3–4):

```ts
// transcriber.ts additions
const ConfidenceSchema = z.object({
  overall: z.enum(['high', 'medium', 'low']),
  summary: z.string(),
  flaggedSpans: z.array(z.object({ text: z.string(), reason: z.string() })),
});
const DraftSchema = z.object({
  transcription_diplomatic: z.string().nullable(),
  transcription_normalized: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  date: z.object({ start: z.string().nullable(), end: z.string().nullable(), precision: z.string() }),
  names: z.array(z.string()),
  documentType: z.string(),
});
const VerifiedSchema = DraftSchema.extend({ confidence: ConfidenceSchema });
export type AiDraft = z.infer<typeof DraftSchema>;
export type AiVerified = z.infer<typeof VerifiedSchema>;
export async function transcribeDraft(client: VisionClient, images: Buffer[], mediaType: string): Promise<AiDraft>;
export async function verifyTranscription(client: VisionClient, images: Buffer[], mediaType: string, draft: AiDraft): Promise<AiVerified>;
```

```ts
// engine.ts
export interface ConfidenceReport { overall: 'high' | 'medium' | 'low'; summary: string; flaggedSpans: { text: string; reason: string }[]; }
export interface TranscriptionResult {
  transcriptionDiplomatic: string | null;
  transcriptionNormalized: string | null;
  title: string;
  description: string;
  date: { start: string | null; end: string | null; precision: string };
  names: string[];
  documentType: string;
  confidence: ConfidenceReport;
}
export interface TranscriptionEngine { transcribe(images: Buffer[], mediaType: string): Promise<TranscriptionResult>; }
export function createLlmVisionEngine(client: VisionClient): TranscriptionEngine;
```

**Prompt contracts:**
- Pass 1 keeps the media-type guidance table idea (letter/article/photo/pdf + fallback) and asks for ONLY a JSON object with exactly the `DraftSchema` keys. It must: describe `transcription_diplomatic` as faithful — original spelling, punctuation, line breaks preserved — and **mandate** the uncertainty markers `[illegible]`, `[?]`, `[possibly Name]` with the rationale "wrong names and dates are worse than blanks"; describe `transcription_normalized` as modernized spelling/punctuation, search-friendly; both `null` when the media has no text; keep the honest-date-precision instruction from the current prompt.
- Pass 2 embeds `JSON.stringify(draft)` and the same media context, instructs: re-examine the image(s), check the transcription word-by-word against the visible text, verify names and dates, correct any errors (keeping/repairing uncertainty markers), and return ONLY a JSON object with the `VerifiedSchema` keys — the full corrected record plus `confidence` (`overall` high/medium/low, a 1–2 sentence `summary`, and `flaggedSpans` quoting each uncertain span from the diplomatic text with a `reason`). An empty `flaggedSpans` array is valid when nothing is uncertain.
- Pass 2 always runs, even when both draft transcriptions are null (it can catch a missed inscription and still verifies names/dates).

**Engine behavior:** `transcribe` = pass 1 → pass 2 → map `AiVerified` (snake_case JSON fields) onto `TranscriptionResult` (camelCase). Any throw from either pass propagates unchanged. No retries, no fallback.

**Test expectations:**
- `tests/transcriber.test.ts` additions: `transcribeDraft` parses a valid dual-field response (including fenced/prose-wrapped JSON — reuse the existing wrapped-response test pattern); pass-1 prompt mentions all three markers and both field names; `transcribeDraft` rejects a response missing `transcription_normalized` with `/AI response invalid/`; `verifyTranscription` prompt contains the draft's JSON (assert a distinctive substring, e.g. the draft title) and parses a corrected response; `verifyTranscription` rejects a response whose `confidence.overall` is not high/medium/low.
- `tests/engine.test.ts`: with a scripted client returning pass-1 then pass-2 responses in order, `transcribe` returns the **pass-2** values (make them differ from pass 1, e.g. a corrected name) with confidence attached and exactly 2 client calls; when the client's second call throws, `transcribe` rejects (assert exactly 2 calls attempted); when pass 2 returns schema-invalid JSON, `transcribe` rejects with `/AI response invalid/`.

- [ ] **Step 1:** Write the new transcriber + engine tests; run `npx vitest run tests/transcriber.test.ts tests/engine.test.ts` — new tests FAIL, old ones still pass.
- [ ] **Step 2:** Implement the schemas, prompts, pass functions, and engine to the contracts.
- [ ] **Step 3:** `npm test` → all green (old `transcribeItem` suite untouched); `npm run typecheck` → clean.
- [ ] **Step 4:** Commit: `feat: add two-pass diplomatic/normalized transcription engine with confidence`

---

### Task 3: Schema swap — DB columns, queue on the engine, delete the old path

**Files:**
- Modify: `src/db.ts` (items table: drop `transcription`; add `transcription_diplomatic TEXT`, `transcription_normalized TEXT`, `ai_confidence TEXT` — in place, keep column order sensible next to `ai_names`)
- Modify: `src/ai/queue.ts`
- Modify: `src/ai/transcriber.ts` (DELETE `transcribeItem`, `SuggestionSchema`, `AiSuggestion`, and the now-unused pass-1-only prompt bits of the old path)
- Modify: `src/server.ts` (mechanical compile-fix ONLY: `ServerDeps.client: VisionClient | null` → `engine: TranscriptionEngine | null`; queue route calls `processPendingItems(deps.db, deps.engine)`; 503 text/PATCH fields unchanged until Task 4)
- Modify: `src/main.ts` (mechanical compile-fix ONLY: wrap the existing Anthropic client in `createLlmVisionEngine` to satisfy the new deps type; full provider wiring is Task 4)
- Modify: `tests/queue.test.ts`, `tests/transcriber.test.ts` (drop old-shape tests), `tests/server.test.ts` + `tests/smoke.test.ts` (rename the `client: null` dep to `engine: null` where they build the server)
- Check: `tests/db.test.ts` for any `transcription` column reference (none expected).

**Interfaces:**
- Consumes: `TranscriptionEngine`, `TranscriptionResult`, `createLlmVisionEngine` from Task 2.
- Produces: `processPendingItems(db: Database.Database, engine: TranscriptionEngine, opts?: { resizeForAi?: (path: string) => Promise<Buffer> }): Promise<{ processed: number; failed: number }>` — same iteration, resize, and error discipline as today.

**Queue write contract:** on success, UPDATE sets `transcription_diplomatic`, `transcription_normalized`, `title`, `description`, `date_start`/`date_end`/`date_precision` (via `normalizeFuzzyDate(result.date)`), `ai_names` (`JSON.stringify(result.names)`), `ai_confidence` (`JSON.stringify(result.confidence)`), `ai_error = NULL`, `status = 'transcribed'`. On any throw: `ai_error` = message, status untouched (`pending`), loop continues.

**Test expectations (`tests/queue.test.ts`, driving a real `createLlmVisionEngine` with scripted fake clients — two responses per item):**
- Happy path: both new columns + `ai_confidence` persisted (parse it back and assert `overall`/`flaggedSpans`), dates normalized (keep the year-expansion assertion), status `transcribed`.
- **Failed second pass:** client succeeds on call 1, throws on call 2 → `{ processed: 0, failed: 1 }`, item `pending`, `ai_error` set, and the transcription columns still NULL (nothing partial written).
- Keep the existing non-Error-throw and reviewed/transcribed-untouched tests, adapted to the engine (scripted client budgets: 2 calls per successfully processed item).

- [ ] **Step 1:** Update/write the tests above; run `npm test` — queue/transcriber suites FAIL against the old implementation.
- [ ] **Step 2:** Apply the schema edit, queue rework, old-path deletion, and the two mechanical compile fixes.
- [ ] **Step 3:** `npm test` → all green; `npm run typecheck` → clean (nothing anywhere references the dropped `transcription` column — grep `src tests` for `\btranscription\b` bare usages to confirm; only `transcription_diplomatic|_normalized` may remain).
- [ ] **Step 4:** Commit: `feat!: store diplomatic+normalized transcriptions with confidence; queue runs on TranscriptionEngine`

---

### Task 4: API + wiring — review fields, parsed confidence, provider-aware 503

**Files:**
- Modify: `src/server.ts`
- Modify: `src/main.ts`
- Modify: `tests/server.test.ts`

**Interfaces:**
- Consumes: `resolveProvider`, both client factories (Task 1), `createLlmVisionEngine` (Task 2).
- Produces: `ServerDeps = { db; archiveDir; cacheDir; engine: TranscriptionEngine | null; aiDisabledMessage?: string }`.

**Behavior contracts:**
- `GET /api/items/:id`: response includes `transcription_diplomatic`, `transcription_normalized` (from `SELECT *`), and `ai_confidence` **parsed into an object** (`null` when the column is null). `ai_names` stays a raw JSON string (frontend contract). If `ai_confidence` contains unparseable JSON (shouldn't happen — zod-gated), return it as `null` rather than 500.
- `PATCH /api/items/:id`: editable string fields become `title`, `description`, `transcription_diplomatic`, `transcription_normalized` (replacing `transcription` in both the known-field check and the SET loop). `date`/`status` semantics unchanged (409/400 rules intact). `ai_confidence` not accepted. The PATCH response passes through the same GET-shape mapping (parsed `ai_confidence`).
- `POST /api/queue/process`: when `deps.engine` is null → 503 `{ error: deps.aiDisabledMessage ?? 'AI transcription not configured' }`.
- `main.ts`: `resolveProvider(process.env)`; on `ok` build `createOpenAIVisionClient(apiKey, { model: process.env.OPENAI_VISION_MODEL })` or `createAnthropicVisionClient(apiKey)`, wrap in `createLlmVisionEngine`, pass as `engine`; on `!ok` pass `engine: null, aiDisabledMessage: message` and `console.warn(message)` once. No other startup behavior changes.

**Test expectations (`tests/server.test.ts`):**
- PATCH updates both transcription fields independently and together; PATCH body containing only `ai_confidence` → 400 (unknown field ⇒ fails the known-field check).
- GET returns parsed `ai_confidence` object after seeding the column with JSON, and `null` when unset.
- Queue route: deps `{ engine: null, aiDisabledMessage: 'AI transcription disabled: TRANSCRIBE_PROVIDER=openai but OPENAI_API_KEY is not set' }` → 503 with exactly that message; keep existing 404/409/400 route tests green.
- A happy-path queue-route test with a real engine + scripted fake client through the HTTP route (import → process → GET shows dual transcriptions + confidence) if `tests/server.test.ts` already has import fixtures; otherwise that lives in Task 5's e2e.

- [ ] **Step 1:** Write/adjust server tests; run `npx vitest run tests/server.test.ts` — FAIL.
- [ ] **Step 2:** Implement server + main changes.
- [ ] **Step 3:** `npm test` green; `npm run typecheck` clean.
- [ ] **Step 4:** Commit: `feat: dual-transcription review API, parsed confidence, provider-aware AI wiring`

---

### Task 5: End-to-end verification + docs

**Files:**
- Modify: `docs/2026-07-07-kintrace-frontend-build-prompt.md` (pin the confidence shape: replace the "exact shape set by the ingestion work" caveats in lines ~31/34 with the concrete `ai_confidence` object `{ overall: 'high'|'medium'|'low', summary, flaggedSpans: [{ text, reason }] }`, note it arrives parsed in GET and is not PATCHable)
- Modify: `CLAUDE.md` (Architecture: add `src/ai/providers.ts` + `src/ai/engine.ts`, two-pass description; Commands/dev note: `TRANSCRIBE_PROVIDER` default openai, `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, `OPENAI_VISION_MODEL`; keep invariants list accurate — "AI responses zod-validated" now covers both passes)

**Verification (controller runs this directly, using the superpowers verification discipline + the `verify` skill):**
- [ ] **Step 1:** `npm test` and `npm run typecheck` — full green, output pristine.
- [ ] **Step 2:** Live pipeline if `OPENAI_API_KEY` is set in the environment: `npm run dev`, import a real scanned letter (any test scan on disk; else reuse an existing pending item), `POST /api/queue/process`, then `GET /api/items/:id` — confirm diplomatic transcription (markers present where the scan warrants), normalized transcription, structured `ai_confidence`, normalized dates, status `transcribed`. If no live key: say so explicitly and drive the identical path end-to-end with a fake `VisionClient` through `buildServer` + queue (import route → process → GET), asserting the same outcomes.
- [ ] **Step 3:** Provider switch: run the same fake-driven path with `TRANSCRIBE_PROVIDER=anthropic` semantics (resolveProvider→anthropic client wiring exercised in tests; note any live Anthropic check not run).
- [ ] **Step 4:** Update the two docs; commit: `docs: pin confidence shape in frontend contract; document HTR pipeline`

---

## Execution model roles (binding for the controller)

- Every **implementer** subagent: dispatch with `model: fable` (Fable 5) — explicit, overriding any cheaper default.
- Every **task reviewer** subagent: `model: opus` (Opus 4.8).
- **Final whole-branch review**: strongest available (Fable 5).
- Controller stays in this session (Fable 5) for plan interpretation and review arbitration.

## Self-review notes

- Spec coverage: provider layer (T1), engine + two passes + prompts + confidence (T2), DB/queue/lifecycle (T3), API/wiring/503 (T4), e2e + cross-impact docs (T5). Always-run-pass-2 pinned in T2; failed-pass-2-stays-pending pinned in T3.
- Green-per-task: old path deleted only in T3 together with its tests; server/main get mechanical compile fixes in T3, behavioral changes in T4.
- Type consistency: `AiDraft`/`AiVerified` (snake_case JSON) vs `TranscriptionResult` (camelCase) mapping happens once, in the engine; queue consumes only `TranscriptionResult`.
