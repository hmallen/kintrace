# Frontend Final Visual Verification — 2026-07-08

In-browser check (Playwright-driven Chromium) of the "archivist's desk"
visual pass (Task 21) against the live backend (:3271) + Vite dev server,
with the same data as the skeleton check (item 1 = 1852 cursive letter,
reviewed; item 2 = 1908 letter, reviewed, month precision; item 3 = photo,
pending).

| # | Check | Result |
|---|-------|--------|
| 1 | Fonts self-hosted (no CDN) — Fraunces `.woff2` bundled by the build under `dist/assets/`; headings/masthead/card titles render in Fraunces serif | PASS |
| 2 | Library: warm paper cards on a deeper desk backdrop, prints-on-a-desk scan mats with shadow, oxblood active-nav underline, functional status chips (green REVIEWED / ochre PENDING), generous whitespace | PASS |
| 3 | Workspace: scan matted as a print (mat + `--kt-shadow-print`), paper review panel, confidence banner (MEDIUM + summary), flagged-span strike-through on resolved spans, oxblood Save, dashed-italic AI-name suggestion chips distinct from confirmed people | PASS |
| 4 | Timeline: month/year range bar filled-center + gradient-faded edges, status hue applied (reviewed → bottle green), undated tray tokenized (dashed border, paper chips) | PASS |
| 5 | Favicon: 🗃️ inline-SVG data URI (prior `/favicon.ico` 404 gone) | PASS |
| 6 | Contrast legible throughout; one accent (oxblood) used only for links/active-nav/primary-action/focus; status hues are functional, not decorative | PASS |
| 7 | Interactions stay fast; no console errors introduced by the restyle | PASS |

All existing web tests remain green (93/93), typecheck clean, production
build succeeds. Screenshots captured to the session scratchpad
(polish-library / polish-workspace / polish-timeline).

Deferred (noted, not blocking): JS bundle > 500 kB (vis-timeline + CodeMirror
+ Uppy) — a code-splitting pass is future work for a local single-user tool.
