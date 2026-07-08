# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

KinTrace builds interactive family history timelines from photos, letters, articles, and other archival media.

## Commands

- `npm test` — run the full test suite (vitest)
- `npx vitest run tests/<file>` — run a single test file
- `npm run typecheck` — TypeScript, no emit
- `npm run dev` — start the server (tsx entry point `src/main.ts`), listens on port 3271, data stored under `./data/`. Transcription provider is chosen by `TRANSCRIBE_PROVIDER` (`openai` default, or `anthropic`) with the matching key (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`); `OPENAI_VISION_MODEL` overrides the default OpenAI model (`gpt-5.5`). Keys are optional — without the selected provider's key the AI queue endpoint is disabled (503) with a warning naming the missing variable.

## Architecture

KinTrace is a Fastify + better-sqlite3 backend that imports archival media, runs it through an AI vision/transcription pass, and serves a REST API for a timeline UI (not yet built). Modules:

- `src/db.ts` — SQLite schema and `openDb()`.
- `src/dates.ts` — fuzzy date normalization (exact/month/year/decade/unknown precision, range expansion).
- `src/importer.ts` — file hashing, dedupe, archiving, and thumbnail generation.
- `src/ai/transcriber.ts` — `VisionClient` seam plus the two-pass HTR prompts and zod schemas: pass 1 drafts a diplomatic transcription (line breaks/spelling preserved, mandatory `[illegible]`/`[?]`/`[possibly Name]` uncertainty markers) and a normalized (modernized, search-friendly) one; pass 2 re-checks the draft against the image, corrects it, and emits a confidence report (`overall` high/medium/low, `summary`, `flaggedSpans[{text,reason}]`).
- `src/ai/providers.ts` — `VisionClient` implementations (`createOpenAIVisionClient`, `createAnthropicVisionClient`) and `resolveProvider` (config-driven selection, no failover).
- `src/ai/engine.ts` — `TranscriptionEngine` abstraction; `createLlmVisionEngine` composes the two passes. Queue/server depend on the engine, never a raw client (future seam for Tesseract/Transkribus-style engines routed by media type).
- `src/ai/queue.ts` — resumable processor for `pending` items; persists both transcriptions plus `ai_confidence` JSON.
- `src/server.ts` — Fastify route factory (`buildServer`); `GET /api/items/:id` returns `ai_confidence` parsed, `PATCH` lets reviewers edit both transcriptions.
- `src/main.ts` — wires the above together and starts listening.

Key invariants: archive originals are never modified after import; item status moves `pending` → `transcribed` → `reviewed` and never backwards automatically (a failed second pass records `ai_error` and leaves the item `pending`); AI responses from both passes are always zod-validated before being trusted; tests inject a fake `VisionClient` (or the fake OpenAI SDK seam) and never call a real OpenAI or Anthropic API.
