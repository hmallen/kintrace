# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KinTrace builds interactive family history timelines from photos, letters, articles, and other archival media.

## Commands

- `npm test` — run the full test suite (vitest)
- `npx vitest run tests/<file>` — run a single test file
- `npm run typecheck` — TypeScript, no emit
- `npm run dev` — start the server (tsx entry point `src/main.ts`), listens on port 3271, data stored under `./data/`. `ANTHROPIC_API_KEY` is optional; without it the AI queue endpoint is disabled (503).

## Architecture

KinTrace is a Fastify + better-sqlite3 backend that imports archival media, runs it through an AI vision/transcription pass, and serves a REST API for a timeline UI (not yet built). Modules:

- `src/db.ts` — SQLite schema and `openDb()`.
- `src/dates.ts` — fuzzy date normalization (exact/month/year/decade/unknown precision, range expansion).
- `src/importer.ts` — file hashing, dedupe, archiving, and thumbnail generation.
- `src/ai/transcriber.ts` — `VisionClient` seam plus zod-validated parsing of AI JSON responses.
- `src/ai/queue.ts` — resumable processor for `pending` items.
- `src/server.ts` — Fastify route factory (`buildServer`).
- `src/main.ts` — wires the above together and starts listening.

Key invariants: archive originals are never modified after import; item status moves `pending` → `transcribed` → `reviewed` and never backwards automatically; AI responses are always zod-validated before being trusted; tests inject a fake `VisionClient` and never call the real Anthropic API.
