# Prompt: Upgrade KinTrace document ingestion (HTR/OCR transcription)

> Paste everything below the line into a fresh Claude Code (Fable 5) session opened at the KinTrace repo root. It is written to be acted on directly. It changes the **backend** transcription pipeline; it is independent of the separate frontend build prompt, but see "Cross-impact" below.

---

You are upgrading **KinTrace's document ingestion / transcription system**. KinTrace builds family-history timelines from scanned letters, photos, articles, and other archival media; an AI pass turns each scan into a draft transcription that a human later reviews. Today that pass is a single Claude-vision call producing one `transcription` string. You are reworking it to reflect handwritten-text-recognition (HTR) best practice and to run on **OpenAI vision by default**. You own the implementation decisions within the constraints below; where I state a preference, honor it.

## Start by loading your skills

Follow this project's normal workflow: **superpowers:brainstorming** to settle the design (surface any disagreement with what's below before coding), then **superpowers:writing-plans** for a written plan, then **superpowers:subagent-driven-development** to execute it task-by-task (TDD, review after each). Load **claude-api** only if you touch the retained Anthropic path. There is no bundled OpenAI skill — your training cutoff is early 2026 and OpenAI's model IDs and vision request shapes change, so **verify the current OpenAI vision model and image-input API from live OpenAI docs** before implementing that client; do not transcribe API details from memory.

## Models for this build (required)

Model choice is per-role: the executing session (the "controller") picks each subagent's model when it dispatches it. Left to its defaults, `subagent-driven-development` picks the *cheapest capable* model for mechanical tasks — override that here.

- **Plan and review on a strong reasoning model.** Run this session on **Opus 4.8 (1M context)** for the brainstorm, the written plan, and the code reviews. The written plan (from `superpowers:writing-plans`) is a **separate artifact** from this prompt — a task-by-task decomposition with interfaces, test specs, and acceptance criteria. Keep it at the level of **contracts and tests, not literal code**, so the implementer makes the real code-level decisions (that's what makes the implementer's model matter).
- **Write the code on Fable 5.** When you execute, dispatch **every implementer (code-writing) subagent with `model: claude-fable-5`**, overriding the skill's cheapest-capable-model default. This is a deliberate quality/consistency choice, not a cost-optimized one.
- **Keep reviewers strong.** Task reviewers on Opus 4.8 or Sonnet 5; the final whole-branch review on the most capable model available — a capable reviewer is what catches an implementer's mistakes.

Simpler alternative: run everything on Fable 5 (planning, code, and review all inherit it). The only tradeoff is slightly weaker plan decomposition and review scrutiny than a top reasoning model gives — acceptable for well-scoped work, but the plan is the highest-leverage artifact, so prefer the strongest model you have for it.

## Source of truth for the design

Read `docs/2026-07-07-chatgpt-htr-ocr-research.md` first — it drives these decisions. Its load-bearing points:
- Old cursive letters are an **HTR** problem, not printed-page OCR. Multimodal LLM vision is a legitimate first-pass engine; an LLM **correction pass** after the first transcription measurably improves accuracy.
- Adopt a **hybrid pipeline**: automated first pass → draft transcription **with confidence/uncertainty notes** → human verification of names/dates/places/unclear words → keep the original image linked.
- Store **two** transcriptions: a **diplomatic** one (preserves spelling, punctuation, line breaks; marks uncertainty) and a **normalized** one (modernized, search-friendly).
- Uncertainty markers are mandatory in the diplomatic text: `[illegible]`, `[?]`, `[possibly Martha]` — "wrong names and dates are worse than blanks."
- **Do not** use Tesseract for connected cursive (it's fine for printed clippings/typed letters/envelopes); Transkribus / eScriptorium+Kraken are heavier archive-grade HTR paths for later.

## Current state (what exists — read before changing)

- `src/ai/transcriber.ts` — the `VisionClient` interface (`analyzeImages(images: Buffer[], prompt: string): Promise<string>`) is the provider seam; `transcribeItem(client, images, mediaType)` builds a media-type-tailored prompt, robustly extracts the JSON object, and zod-validates it (`SuggestionSchema`: `transcription` (nullable), `title`, `description`, `date{start,end,precision}`, `names[]`, `documentType`). `createAnthropicVisionClient(apiKey)` is the only implementation (model `claude-sonnet-5`, base64 JPEG blocks).
- `src/ai/queue.ts` — `processPendingItems` loads each pending item's image(s), calls `transcribeItem`, normalizes the date via `normalizeFuzzyDate`, and writes `transcription`, `title`, `description`, date fields, `ai_names`, sets status `transcribed`, clears `ai_error`. Per-item failures are captured in `ai_error`, item stays `pending`.
- `src/db.ts` — the `items` table stores `transcription TEXT`, `ai_names TEXT`, `ai_error TEXT`, `thumb_path TEXT`, plus the fuzzy-date fields and the `pending→transcribed→reviewed` status CHECK. **Schema is pre-release: edit `CREATE TABLE` in place, no migrations** (a fresh DB is fine).
- `src/server.ts` — `PATCH /api/items/:id` accepts `transcription` (among title/description/date/status); `GET /api/items/:id` returns it.
- `src/main.ts` — builds the client from `ANTHROPIC_API_KEY` (AI disabled if unset).
- Tests inject a **fake `VisionClient`** and never call a real API (`tests/transcriber.test.ts`, `tests/queue.test.ts`).

## The changes (my decisions — honor these)

### 1. OpenAI as default provider, Claude retained and config-switchable
- Add `createOpenAIVisionClient(apiKey)` implementing the same `VisionClient` seam (verify the current OpenAI vision model + image-input request shape from docs). Keep `createAnthropicVisionClient` and the `@anthropic-ai/sdk` dependency; add the `openai` dependency.
- Select the provider by config: `TRANSCRIBE_PROVIDER=openai|anthropic`, **default `openai`**. No automatic failover between providers — a manual switch only.
- `src/main.ts` wires the chosen provider from the matching key (`OPENAI_API_KEY` for openai, `ANTHROPIC_API_KEY` for anthropic); if the selected provider's key is missing, AI stays disabled with a clear warning (same shape as today). Update the queue's 503-when-unconfigured path accordingly.
- Both clients must remain trivially fakeable so tests never hit a network. Do not let OpenAI-specific types leak past the `VisionClient` boundary.

### 2. Pluggable transcription-engine interface (LLM vision only for now)
- Introduce a `TranscriptionEngine` abstraction one level above the provider: e.g. `transcribe(images, mediaType) → TranscriptionResult`. Ship a single `LlmVisionEngine` that wraps a `VisionClient` (OpenAI or Claude). The interface must carry `mediaType` so a future engine-router can dispatch (cursive → LLM/HTR, printed → Tesseract, archive → Transkribus/Kraken) without reshaping callers.
- **Do not build Tesseract, Transkribus, or Kraken engines now.** Just leave the seam clean for them. Keep `processPendingItems` talking to a `TranscriptionEngine`, not a raw `VisionClient`.

### 3. Diplomatic + normalized transcription, with uncertainty markers
- The engine output (and the zod schema replacing/extending `SuggestionSchema`) must carry **both** `transcription_diplomatic` and `transcription_normalized` (each nullable — null when the media has no text, e.g. a photo without inscription). The diplomatic text preserves line breaks/spelling/punctuation and uses the `[illegible]` / `[?]` / `[possibly Name]` markers; the normalized text is modernized and search-friendly. Update the media-type prompt(s) to request both and to mandate the markers.
- Reflect this in the DB (`items.transcription_diplomatic`, `items.transcription_normalized` — replace the single `transcription` column, editing the schema in place), in `processPendingItems`, and in the API (`GET` returns both; `PATCH` lets a reviewer edit both). Update every test that referenced the old single field. Keep AI output zod-validated before it touches the DB.

### 4. Second-pass verification with confidence
- After the first transcription, run a **second AI pass** that re-checks the transcription, names, and dates against the image, corrects errors, and flags low-confidence spans. Design the result shape (validated with zod) so the human-review UI can render reliability — e.g. an overall/section confidence plus a structured list of flagged uncertain spans (text + reason). Persist enough of it for the frontend review screen; store it structured (JSON column) rather than as prose buried in the transcription.
- Both passes go through the injected `VisionClient`, so tests drive them with a fake (e.g. a scripted client returning pass-1 then pass-2 responses). Cost/latency roughly doubles per item — that's accepted; make the second pass a clear, testable step, not an inlined afterthought.

## Global constraints (carry forward from the backend)

- ESM, TypeScript strict. All AI responses **zod-validated before any DB write**. Item status lifecycle stays exactly `pending → transcribed → reviewed`; per-item failure still records `ai_error` and leaves the item `pending` (a failed second pass shouldn't silently promote an item).
- Tests must **not** call a real OpenAI or Anthropic API — inject fakes through the `VisionClient` seam. Test output pristine.
- Pre-release schema: edit `db.ts` `CREATE TABLE` in place, no migration code, but update `db.ts` + `queue.ts` + `server.ts` + `main.ts` + all affected tests coherently in the same work so nothing references a dropped column.
- Commit after every green test cycle. Match the existing code's style and the TDD discipline already in the repo.

## Cross-impact (flag, don't silently break)

Replacing the single `transcription` field with diplomatic/normalized + confidence/flagged-spans changes the API shape the **frontend** consumes. The separate frontend build prompt (`docs/2026-07-07-kintrace-frontend-build-prompt.md`) documents the old single `transcription` field and a diff/accept-reject review UX — its review screen should consume the new dual transcriptions and the confidence/flagged-span data. Note this in your plan; if you change `GET`/`PATCH` response shapes, call out exactly what the frontend contract becomes so that prompt can be updated to match.

## Verification & definition of done

- Drive the real pipeline, not just unit tests: with a provider key set, run `npm run dev`, import a real scanned letter (or use an existing item), trigger `POST /api/queue/process`, and confirm the item ends with a diplomatic transcription (containing uncertainty markers where appropriate), a normalized transcription, structured confidence/flagged spans, normalized dates, and status `transcribed`. Use the **verify** skill. If you have no live key, say so and drive the whole pipeline with a fake client through the queue instead — but exercise it end to end.
- Provider switch verified: the same item path works with `TRANSCRIBE_PROVIDER=anthropic` (via fake in tests; note any live check you couldn't run).
- `npm test` green, `npm run typecheck` clean, each task committed. New tests cover: the OpenAI client's response parsing (against a fake HTTP/SDK layer), provider selection, the two-pass flow (including a failing second pass leaving the item pending), and the diplomatic/normalized/uncertainty-marker output.

Begin with brainstorming. Ask me anything you need before writing the plan; otherwise produce the plan, show it to me for approval, then execute it task-by-task.
