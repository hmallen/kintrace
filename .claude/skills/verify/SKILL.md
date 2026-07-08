---
name: verify
description: Drive the KinTrace backend end-to-end over HTTP to verify changes at the API surface
---

# Verifying KinTrace

Surface is the REST API on `http://127.0.0.1:3271` (override with `PORT`).

## Launch

```bash
npm run dev   # background it; data lands in ./data/ (gitignored)
```

AI queue needs a provider key: `OPENAI_API_KEY` (default provider) or
`TRANSCRIBE_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`. Without one the server
still runs; `POST /api/queue/process` returns 503 naming the missing var.

## Drive the pipeline

```bash
# JSON bodies via a payload file — inline -d with Windows paths gets mangled in Git Bash.
# Use forward slashes in paths; Node accepts them on Windows.
printf '{"paths":["C:/path/to/scan.jpg"],"mediaType":"letter"}' > /tmp/import.json
curl -s -X POST :3271/api/import -H 'Content-Type: application/json' -d @/tmp/import.json
curl -s -X POST :3271/api/queue/process   # live two-pass ≈ 2min/item on OpenAI
curl -s :3271/api/items/1                 # transcription_diplomatic/_normalized, parsed ai_confidence
```

Expected after processing: status `transcribed`, diplomatic text with uncertainty
markers (`[illegible]`/`[?]`/`[possibly Name]`) where warranted, `ai_confidence`
as a parsed object `{overall, summary, flaggedSpans}`.

## Test input

Good public-domain cursive scan (600 DPI, 1852 family letter):

```bash
curl -sL -o letter.jpg "https://commons.wikimedia.org/wiki/Special:FilePath/Letter%20signed%20Sarah%20(Sarah%20Lane%20Glasgow)%2C%20St.%20Louis%2C%20to%20Ann%20E.%20Lane%2C%20Pittsburgh%2C%20February%204%2C%20(1852%3F).jpg"
file letter.jpg   # confirm JPEG — a bad filename returns an HTML page silently
```

## Probes worth repeating

- PATCH unknown field only → 400; `ai_confidence` is not patchable.
- PATCH `transcription_diplomatic` + `status:"reviewed"` → persists, other fields untouched.
- Re-import same file → `duplicate: true`; re-run queue → reviewed/transcribed items untouched.
- Restart with `TRANSCRIBE_PROVIDER=anthropic` and no key → exact 503 message; `TRANSCRIBE_PROVIDER=bogus` → startup warning, server still serves.

## Gotchas

- Dedupe is by content hash: re-verifying with the same image needs a fresh
  `./data` (or delete `kintrace.db*`) to get a new item.
- Live queue calls are slow (two vision passes per item) — use `--max-time 480`.
