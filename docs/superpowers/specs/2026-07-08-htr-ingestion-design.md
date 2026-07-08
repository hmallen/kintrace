# HTR/OCR Ingestion Upgrade — Design

**Date:** 2026-07-08
**Status:** Approved (design approved in session; always-run pass 2 confirmed)
**Drives:** rework of the AI transcription pass per `docs/2026-07-07-chatgpt-htr-ocr-research.md`
**Consumes/updates contract in:** `docs/2026-07-07-kintrace-frontend-build-prompt.md`

## Goal

Turn KinTrace's single-call, single-string transcription pass into an HTR-informed two-pass
pipeline: OpenAI vision by default (Claude retained, config-switchable), diplomatic +
normalized transcriptions with mandatory uncertainty markers, and a structured second-pass
verification with confidence/flagged spans for the human review UI.

## Fixed decisions (from the ingestion prompt + session Q&A)

- OpenAI is the default provider (`TRANSCRIBE_PROVIDER=openai|anthropic`, default `openai`);
  no automatic failover. Claude path and `@anthropic-ai/sdk` stay.
- A `TranscriptionEngine` abstraction sits above `VisionClient`; only `LlmVisionEngine`
  ships now. No Tesseract/Transkribus/Kraken engines — just a clean seam that carries
  `mediaType` for a future router.
- Two transcriptions stored and served: `transcription_diplomatic` (line breaks, original
  spelling/punctuation, `[illegible]` / `[?]` / `[possibly Name]` markers mandated) and
  `transcription_normalized` (modernized, search-friendly). Both nullable (no-text media).
- Second AI pass always runs — including when pass 1 found no text (it can catch a missed
  inscription and still verifies names/date estimates). Cost doubling accepted.
- Item lifecycle unchanged: `pending → transcribed → reviewed`; any pass failure records
  `ai_error` and leaves the item `pending`. All AI output zod-validated before DB writes.
- Pre-release schema: edit `CREATE TABLE` in place, no migrations.
- Tests never call a real API; everything fakes through the `VisionClient` seam.

## Architecture

### Provider layer — `src/ai/providers.ts` (new)

`VisionClient` is unchanged: `analyzeImages(images: Buffer[], prompt: string): Promise<string>`.

- `createAnthropicVisionClient(apiKey)` — moved verbatim from `transcriber.ts`
  (model `claude-sonnet-5`, base64 JPEG blocks), max output tokens raised (see Prompts).
- `createOpenAIVisionClient(apiKey, opts?)` — new, built on the `openai` npm SDK's
  **Responses API** (verified against live OpenAI docs 2026-07-08):
  - request: `responses.create({ model, max_output_tokens, input: [{ role: 'user', content:
    [...images as { type: 'input_image', image_url: 'data:image/jpeg;base64,<b64>' },
    { type: 'input_text', text: prompt }] }] })` — multiple `input_image` parts per message
    are supported; exact parameter names confirmed against installed SDK typings at
    implementation time (strict TS makes a wrong name a compile error).
  - model: default `gpt-5.5` (current flagship; accuracy over cost for cursive HTR),
    overridable via `OPENAI_VISION_MODEL` / `opts.model`.
  - response text read from the SDK's aggregate `output_text`.
  - `opts.sdk` (or equivalent) injects a minimal internal SDK-shaped interface so tests
    exercise request building + response parsing with no network. No OpenAI SDK types leak
    past the `VisionClient` boundary — the internal interface is defined by us.
- `resolveProvider(env)` — reads `TRANSCRIBE_PROVIDER` (default `openai`), pairs it with
  the matching key env var (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`). Returns either a
  ready descriptor (provider + apiKey) or a disabled result naming the missing/invalid
  variable so `main.ts` and the 503 path can emit a precise message. Unknown provider
  values are a startup warning + disabled AI, not a crash.

### Engine layer — `src/ai/engine.ts` (new)

```ts
export interface TranscriptionEngine {
  transcribe(images: Buffer[], mediaType: string): Promise<TranscriptionResult>;
}
```

`TranscriptionResult` (also the shape persisted by the queue):

```ts
{
  transcriptionDiplomatic: string | null;
  transcriptionNormalized: string | null;
  title: string;
  description: string;
  date: { start: string | null; end: string | null; precision: string };
  names: string[];
  documentType: string;
  confidence: ConfidenceReport;
}
```

`createLlmVisionEngine(client: VisionClient): TranscriptionEngine` is the only
implementation. `processPendingItems` and `buildServer` depend on `TranscriptionEngine`,
never on a raw `VisionClient`. The interface carries `mediaType` so a future router can
dispatch cursive → LLM/HTR, printed → Tesseract, archive → Transkribus/Kraken without
reshaping callers.

### Two-pass flow — `src/ai/transcriber.ts` (reworked)

- **Pass 1 (draft):** media-type-tailored prompt (letter/article/photo/pdf guidance kept,
  upgraded) requesting both transcriptions, mandating the uncertainty markers in the
  diplomatic text, plus title/description/date/names/documentType. Validated by
  `DraftSchema` (replaces `SuggestionSchema`).
- **Pass 2 (verify):** the same images re-sent with the pass-1 JSON embedded in a
  verification prompt: re-check transcription, names, and dates against the image, correct
  errors, keep/repair uncertainty markers, and emit a confidence report. Returns the full
  **corrected** record + `confidence`, validated by `VerifiedSchema` (a superset of
  `DraftSchema`). The pass-2 record is what gets persisted; pass-1 output is intermediate.
- Both passes reuse the existing robust JSON extraction (fences, balanced braces).
- Each pass is an exported, individually testable function; the engine composes them.
- Failure anywhere (network, no JSON, schema mismatch) throws → queue writes `ai_error`,
  item stays `pending`. A failed pass 2 never promotes an item.
- Output token budget roughly doubles (two transcriptions + confidence): Anthropic
  `max_tokens` and OpenAI `max_output_tokens` set to 8192.

### Confidence shape

```ts
ConfidenceReport = {
  overall: 'high' | 'medium' | 'low';
  summary: string;                                    // 1–2 sentence reviewer-facing note
  flaggedSpans: { text: string; reason: string }[];   // spans as they appear in the diplomatic text
}
```

Categorical `overall` (LLM numeric self-confidence is poorly calibrated; the review UI
needs a traffic light). `flaggedSpans[].text` quotes the uncertain span (typically
containing a marker, e.g. `"[possibly Martha]"`) so the UI can locate/highlight it;
`reason` explains (e.g. `"name unclear, could be Mabel"`). Stored as JSON text in
`items.ai_confidence`; never edited by reviewers (it describes the AI draft — human edits
supersede it).

## Data model (`src/db.ts`, in-place edit)

`items`: drop `transcription`; add `transcription_diplomatic TEXT`,
`transcription_normalized TEXT`, `ai_confidence TEXT`. Everything else unchanged.

## API contract (`src/server.ts`)

- `GET /api/items/:id` — returns `transcription_diplomatic`, `transcription_normalized`,
  and `ai_confidence` **parsed as an object** (or `null`); `ai_names` stays a JSON string
  as today.
- `PATCH /api/items/:id` — editable field list becomes `title`, `description`,
  `transcription_diplomatic`, `transcription_normalized` (+ existing `date`, `status`
  semantics unchanged). `ai_confidence` is not patchable.
- `POST /api/queue/process` — 503 when AI is disabled, message naming the selected
  provider's missing env var (e.g. `AI not configured (set OPENAI_API_KEY)`); returns
  `{ processed, failed }` as today.
- `buildServer` deps: `client: VisionClient | null` becomes `engine: TranscriptionEngine
  | null`, plus `aiDisabledMessage: string` (supplied by `main.ts` from `resolveProvider`,
  e.g. `AI not configured (set OPENAI_API_KEY)`) used verbatim as the 503 error body.

## Wiring (`src/main.ts`)

`resolveProvider(process.env)` → build the matching `VisionClient` → wrap in
`createLlmVisionEngine` → pass to `buildServer`. If disabled, warn once with the precise
env var and keep serving (AI endpoints 503) — same shape as today.

## Queue (`src/ai/queue.ts`)

`processPendingItems(db, engine, opts)` — same iteration/error discipline; persists
`transcription_diplomatic`, `transcription_normalized`, `ai_confidence`
(`JSON.stringify`), plus existing title/description/dates/`ai_names`, sets `transcribed`,
clears `ai_error`.

## Testing

All AI interaction faked via `VisionClient`; scripted fakes return pass-1 then pass-2
responses in order. Coverage:

- **transcriber:** dual-field parsing; prompts mandate markers and both transcriptions;
  pass-2 prompt embeds the draft; each pass rejects schema-invalid output.
- **engine:** happy path composes both passes and returns the corrected record +
  confidence; pass-2 failure (throw or invalid JSON) propagates.
- **providers:** OpenAI client builds the documented request and parses responses against
  a fake SDK layer (no network); provider selection — default openai, explicit anthropic,
  missing key → disabled with correct message.
- **queue:** dual columns + `ai_confidence` persisted; failed second pass leaves the item
  `pending` with `ai_error`; existing pending/reviewed semantics retained.
- **server:** GET returns both transcriptions + parsed confidence object; PATCH edits both
  transcription fields; 503 message reflects the selected provider.
- Existing tests referencing `transcription` updated coherently with the schema.

## Verification (definition of done)

- `npm test` green, `npm run typecheck` clean, commit per green TDD cycle.
- End-to-end via the **verify** skill: with a live key (`OPENAI_API_KEY` if present),
  `npm run dev`, import a scanned letter, `POST /api/queue/process`, confirm diplomatic
  (with markers where appropriate) + normalized transcriptions, structured confidence,
  normalized dates, status `transcribed`. Without a live key, drive the same path
  end-to-end with a fake client through the queue and say so.
- Provider switch: `TRANSCRIBE_PROVIDER=anthropic` path exercised (fake-driven in tests;
  note any live check not run).

## Cross-impact

`docs/2026-07-07-kintrace-frontend-build-prompt.md` already documents the post-upgrade
contract (dual transcriptions, `TRANSCRIBE_PROVIDER`, 503 semantics). After landing, pin
its "exact confidence shape TBD" caveat to the `ConfidenceReport` shape above.

## Execution model roles

Session (brainstorm/plan/final review): Fable 5 — strongest available, per the prompt's
"prefer the strongest model for the plan". Implementer subagents: explicitly
`claude-fable-5`. Task reviewers: Opus 4.8. Final whole-branch review: Fable 5.
