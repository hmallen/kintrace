# Frontend Walking-Skeleton Verification — 2026-07-08

Executed in a real browser (Playwright-driven Chromium) against the live
backend (`npm run dev`, :3271) and Vite dev server (:5173, `/api` proxy).
Test data: item 1 = real 1852 cursive letter (reviewed, medium confidence,
5 flagged spans, from the HTR pipeline e2e); item 2 = sample 1908 letter
imported via `POST /api/import` and transcribed live through the OpenAI
two-pass pipeline (`POST /api/queue/process` → `{processed:1,failed:0}`);
item 3 = sample photo left `pending`.

| # | Step | Result |
|---|------|--------|
| 1 | Library lists items with thumbnails, status chips, media-type icons, honest date labels ("June 14, 1908" / "Undated"), date order nulls-last | PASS |
| 2 | Open item → workspace shows the scan (file endpoint, zoom controls), confidence banner (overall + summary), both transcriptions behind diplomatic-default tabs, flagged spans listed with reasons (item 1: 5 spans incl. `Mr Eliot[?]'s lecture`) | PASS |
| 3 | Edit title + date/precision; Save; PATCH body captured on the wire = `{"title":…,"date":{"start":"1908-06-14","precision":"month"}}` — only changed fields, no `ai_confidence`; refetch shows persisted values; live preview "Jun 1, 1908 – Jun 30, 1908" via shared normalizeFuzzyDate | PASS |
| 4 | Create-and-link a new person (author: Ernest) and link an existing person (subject: Ernest); role-grouped chips update | PASS |
| 5 | Mark reviewed on `transcribed` item → PATCH body exactly `{"status":"reviewed"}`, chip flips to reviewed; on `pending` item button disabled with visible reason "item hasn't been transcribed yet"; null-transcription empty state + "Start transcription"; date input disabled under `unknown` | PASS |
| 6 | `/timeline` renders item 2's fuzzy span as a June 1908 range bar (month precision) at the correct position; 2 undated items reported (tray lands in Stage 3) | PASS (after fix) |

## Defect found & fixed

- **Timeline window opened at today (2026), data out of view** — vis-timeline
  does not auto-fit after `setItems`. Fix `9d08213`: guarded
  `fit({ animation: false })` after `setItems` when data is non-empty
  (`web/src/components/TimelineView.tsx`). Re-verified in browser: June 1908
  bar visible and correctly spanned.

## Notes

- Only console error across all flows: missing `/favicon.ico` (benign;
  address in the Task 21 polish pass).
- A stale backend from a previous session was found holding :3271 serving
  pre-Task-3 code (thumbnail 404); killed and restarted from this worktree.
