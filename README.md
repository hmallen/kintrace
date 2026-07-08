# KinTrace

KinTrace builds interactive family history timelines from photos, letters, articles, PDFs, audio, video, and other archival media.

The project currently includes a Fastify + SQLite backend and a React/Vite frontend. The backend imports archival files, stores immutable archive copies, creates thumbnails where possible, runs optional AI transcription over pending items, and exposes a REST API for review and timeline workflows.

## Requirements

- Node.js 26 or newer is recommended. The project uses modern TypeScript, Vite, Vitest, and ESM packages.
- npm.
- Optional: an OpenAI or Anthropic API key for AI transcription.

## Project Layout

- `src/` - backend API, database schema, importer, fuzzy date handling, and AI transcription queue.
- `shared/` - shared API and date contracts used by backend and frontend.
- `web/` - React/Vite frontend for importing, browsing, reviewing, people, and timeline views.
- `tests/` - backend and shared-contract tests.
- `docs/` - design notes, implementation plans, and research prompts.
- `data/` - local runtime data, created automatically and ignored by git.

## Setup

Install backend dependencies from the repository root:

```sh
npm install
```

Install frontend dependencies:

```sh
cd web
npm install
```

Return to the repository root for backend commands:

```sh
cd ..
```

## Configuration

The backend reads these environment variables:

- `PORT` - API port. Defaults to `3271`.
- `KINTRACE_DATA` - runtime data directory. Defaults to `./data`.
- `TRANSCRIBE_PROVIDER` - AI provider, either `openai` or `anthropic`. Defaults to `openai`.
- `OPENAI_API_KEY` - required when `TRANSCRIBE_PROVIDER=openai`.
- `OPENAI_VISION_MODEL` - optional OpenAI vision model override. Defaults to the provider implementation default.
- `ANTHROPIC_API_KEY` - required when `TRANSCRIBE_PROVIDER=anthropic`.

API keys are optional for local browsing and import work. If the selected provider key is missing, the backend still starts, but `POST /api/queue/process` returns `503` and logs which variable is missing.

The frontend can also read:

- `VITE_API_BASE` - API base URL. Leave unset for local Vite development, where `/api` is proxied to `http://127.0.0.1:3271`.

## Running Locally

Start the backend from the repository root:

```sh
npm run dev
```

The API listens on:

```text
http://127.0.0.1:3271
```

In a second terminal, start the frontend:

```sh
cd web
npm run dev
```

Open the Vite URL printed by the frontend. In development, frontend `/api` requests are proxied to the backend.

## Common Commands

Backend and shared tests:

```sh
npm test
```

Run one backend test file:

```sh
npx vitest run tests/server.test.ts
```

Backend typecheck:

```sh
npm run typecheck
```

Frontend tests:

```sh
cd web
npm test
```

Frontend typecheck:

```sh
cd web
npm run typecheck
```

Frontend production build:

```sh
cd web
npm run build
```

## Usage

1. Start the backend with `npm run dev`.
2. Start the frontend with `cd web && npm run dev`.
3. Use the Import view to upload files and choose a media type: `photo`, `letter`, `article`, `audio`, `video`, or `pdf`.
4. Imported originals are copied into the archive under `KINTRACE_DATA` or `./data`; originals are not modified.
5. Use the Library and Workspace views to browse items, inspect media, edit metadata, review transcriptions, and mark completed items as reviewed.
6. Use the People view to add people, then associate them with items as subjects, authors, or recipients.
7. Use the Timeline view to see dated and undated items.

To run AI transcription for pending items, configure the selected provider key and call the queue endpoint:

```sh
curl -X POST http://127.0.0.1:3271/api/queue/process
```

The queue processes pending items, validates both AI passes before trusting the output, stores diplomatic and normalized transcriptions, extracts AI names, and writes an `ai_confidence` report. If processing fails, the item remains pending and records `ai_error`.

## Runtime Data

By default, runtime files are stored under `./data`:

- `data/kintrace.db` - SQLite database.
- `data/archive/` - imported archival originals.
- `data/cache/` - generated thumbnails and derived cache files.
- `data/staging/` - temporary upload staging area.

`data/` and `*.db` are ignored by git. Set `KINTRACE_DATA` to use a different local data directory.

## API Overview

Key backend endpoints:

- `GET /api/items` - list items, with optional `status` and `personId` filters.
- `GET /api/items/:id` - fetch item details, parsed AI confidence, and associated people.
- `PATCH /api/items/:id` - update title, description, fuzzy date, transcriptions, or mark a transcribed item as reviewed.
- `GET /api/items/:id/thumbnail` - stream the generated thumbnail.
- `GET /api/items/:id/file` - stream the archived original.
- `POST /api/items/:id/people` - attach a person to an item as `subject`, `author`, or `recipient`.
- `GET /api/people` - list people.
- `POST /api/people` - create a person.
- `POST /api/import` - import files by local path.
- `POST /api/upload` - upload and import files via multipart form data.
- `POST /api/queue/process` - process pending items with the configured AI provider.

## Development Notes

- The backend uses `better-sqlite3`; schema creation happens in `src/db.ts`.
- Item status moves `pending` to `transcribed` to `reviewed`. The queue does not automatically move failed items backward.
- Fuzzy dates support exact, month, year, decade, and unknown precision.
- Tests inject fake AI clients and must not call real OpenAI or Anthropic APIs.
- Archive originals should be treated as immutable after import.
