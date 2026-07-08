# KinTrace v1 — Design

**Date:** 2026-07-07
**Status:** Approved design, pre-implementation

## Overview

KinTrace is a personal, local web app for organizing a family archive — scanned photos, handwritten letters, articles, and mixed digital media — and viewing it as an interactive timeline. The primary experience is *organizing*: ingesting media, AI-assisted transcription and metadata suggestion, and human review. The timeline is the payoff view over the organized data.

- **Audience:** single user (and family on the local network). No accounts or auth.
- **Stack:** TypeScript full-stack — Node backend (Fastify), React frontend, SQLite. Image processing via `sharp`. AI via the Claude API (vision), chosen because handwritten cursive transcription requires a vision LLM; traditional OCR is not viable.
- **Non-goals (v1):** hosting/deployment, multi-user, local AI models, face recognition, editing/enhancing scans.

## Storage & data model

- **Archive folder** (e.g., `~/KinTrace/archive/`): originals, copied in on import, never modified.
- **Cache folder:** thumbnails and web-sized derivatives, regenerable.
- **SQLite** (`kintrace.db`) holds all metadata. FTS5 for full-text search.
- **JSON export:** on-demand dump of all metadata alongside the archive, so the data outlives the app.

### Tables

- **items** — one row per artifact (photo, letter, article, audio, video, PDF): file path, content hash, media type, title, description, fuzzy date, transcription, status (`pending → transcribed → reviewed`).
- **pages** — ordered image files composing a multi-page item (e.g., a 4-page letter).
- **people** — name, birth/death dates (fuzzy), notes.
- **item_people** — links people to items, with a role (subject, author, recipient).
- **events** — dated events not tied to media (weddings, moves, births); timeline anchors. Populated manually or by GEDCOM import.

### Fuzzy dates

Every dated entity stores `date_start`, `date_end`, and a precision flag: `exact | month | year | decade | unknown`. The timeline renders imprecise dates as spans or decade buckets rather than fake exact points.

## Ingest & AI pipeline

1. **Import** — drag-and-drop or point at a folder. Files are hashed (dedupe), copied to the archive, thumbnailed with `sharp`, and inserted as `pending`.
2. **AI pass** — a background queue sends each image to the Claude API with a media-type-tailored prompt. Response is structured JSON: transcription, suggested title/description, date guess + precision, names mentioned, document type. Multi-page items are transcribed page-by-page and stitched. Queue is resumable (survives restarts) for overnight batch ingest.
3. **Review** — the core UI. Scan displayed beside AI suggestions as editable prefills: correct transcription, confirm/fix date, link mentioned names to `people` records (inline person creation). Saving marks the item `reviewed`.

Nothing AI-generated is trusted until reviewed. Unreviewed items may appear greyed out on the timeline.

**GEDCOM import** — separate one-shot flow: parse, create/match `people` and `events`.

## UI

React SPA, three main views:

1. **Review queue** — keyboard-friendly, optimized for processing hundreds of items fast.
2. **Timeline** — horizontally scrollable/zoomable, custom-built with virtualized rendering. Item cards at date positions; fuzzy dates as spans/buckets. Filters: person, media type, date range. Item detail panel: zoom/pan scan viewer, transcription side-by-side, linked people, editable metadata.
3. **People** — person list; person page shows their events and linked items (per-person mini-timeline).

Global full-text search (titles, descriptions, transcriptions) via FTS5.

## Error handling

- AI failures (rate limits, malformed responses) leave the item `pending` with a retry action; the queue never drops items.
- Originals are never modified; hash dedupe prevents double import.
- All AI responses validated against a schema before use.

## Testing

- Unit tests for ingest pipeline, fuzzy-date logic, and GEDCOM parsing.
- AI layer tested against a mocked Claude client.
- UI verified by driving the real app end-to-end.
