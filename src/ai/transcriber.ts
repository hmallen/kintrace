import { z } from 'zod';

export interface VisionClient {
  analyzeImages(images: Buffer[], prompt: string): Promise<string>;
}

const SuggestionSchema = z.object({
  transcription: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  date: z.object({
    start: z.string().nullable(),
    end: z.string().nullable(),
    precision: z.string(),
  }),
  names: z.array(z.string()),
  documentType: z.string(),
});

export type AiSuggestion = z.infer<typeof SuggestionSchema>;

const MEDIA_GUIDANCE: Record<string, string> = {
  letter:
    'This is a scan of a letter, likely handwritten (possibly cursive). Transcribe it faithfully, marking illegible words as [illegible].',
  article:
    'This is a scan of a newspaper or magazine article. Transcribe the full text including headline.',
  photo:
    'This is a photograph. Set transcription to null unless there is writing on it (captions, inscriptions on the back).',
  pdf: 'This is a scanned document. Transcribe all legible text.',
};

function buildPrompt(mediaType: string): string {
  const guidance = MEDIA_GUIDANCE[mediaType] ?? 'This is an archival family document.';
  return `You are helping organize a family history archive. ${guidance}

Analyze the image(s) and respond with ONLY a JSON object, no other text:
{
  "transcription": string | null,   // full transcription, or null if no text
  "title": string,                  // short descriptive title
  "description": string,            // 1-2 sentence description
  "date": { "start": "YYYY-MM-DD" | null, "end": "YYYY-MM-DD" | null, "precision": "exact" | "month" | "year" | "decade" | "unknown" },
  "names": string[],                // people named or depicted
  "documentType": string            // e.g. "personal letter", "portrait photograph"
}
If the date is uncertain, estimate a range and choose the honest precision.`;
}

/**
 * Attempts to parse a balanced `{...}` span starting at `start` (which must be
 * the index of a `{` character in `text`). Walks forward tracking brace depth
 * while skipping over string literals (respecting `\"` escapes) so that braces
 * inside string values don't confuse the depth count. Returns the parsed value
 * once a depth-0 balanced span is found and successfully `JSON.parse`s, or
 * `null` if no such span exists or the balanced span isn't valid JSON.
 */
function tryParseBalancedObject(text: string, start: number): unknown | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          const value: unknown = JSON.parse(candidate);
          return value;
        } catch {
          // Balanced but not valid JSON (e.g. `{handwriting}`) - give up on
          // this start position, caller will try the next `{`.
          return null;
        }
      }
    }
  }

  return null;
}

/** Scans `text` left to right, returning the first balanced `{...}` span that parses to a non-null object. */
function findFirstJsonObject(text: string): unknown | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      const value = tryParseBalancedObject(text, i);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return value;
      }
    }
  }
  return null;
}

/**
 * Robustly extracts the first JSON object from an AI response. Prefers the
 * content of fenced code blocks (``` or ```json) if present, falling back to
 * scanning the raw text. Unlike a greedy first-`{`-to-last-`}` regex, this
 * correctly handles stray braces in surrounding prose (e.g. "...the
 * {handwriting} style.") by tracking brace depth and skipping string literals.
 */
function extractJsonObject(text: string): unknown {
  const fenceRegex = /```(?:json)?\n?([\s\S]*?)```/g;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRegex.exec(text)) !== null) {
    const found = findFirstJsonObject(fenceMatch[1]);
    if (found !== null) return found;
  }

  const found = findFirstJsonObject(text);
  if (found !== null) return found;

  throw new Error('AI response invalid: no JSON object found');
}

export async function transcribeItem(
  client: VisionClient,
  images: Buffer[],
  mediaType: string
): Promise<AiSuggestion> {
  const text = await client.analyzeImages(images, buildPrompt(mediaType));
  const parsed = extractJsonObject(text);
  const result = SuggestionSchema.safeParse(parsed);
  if (!result.success) throw new Error(`AI response invalid: ${result.error.message}`);
  return result.data;
}

// --- Two-pass transcription (draft -> verify) ---

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
  date: z.object({
    start: z.string().nullable(),
    end: z.string().nullable(),
    precision: z.string(),
  }),
  names: z.array(z.string()),
  documentType: z.string(),
});

const VerifiedSchema = DraftSchema.extend({ confidence: ConfidenceSchema });

export type AiDraft = z.infer<typeof DraftSchema>;
export type AiVerified = z.infer<typeof VerifiedSchema>;

const TWO_PASS_MEDIA_GUIDANCE: Record<string, string> = {
  letter:
    'This is a scan of a letter, likely handwritten (possibly cursive). Treat it as a handwritten-text-recognition task and transcribe it faithfully.',
  article:
    'This is a scan of a newspaper or magazine article. Transcribe the full text including headline.',
  photo:
    'This is a photograph. Set both transcription fields to null unless there is writing on it (captions, inscriptions on the back).',
  pdf: 'This is a scanned document. Transcribe all legible text.',
};

function mediaGuidance(mediaType: string): string {
  return TWO_PASS_MEDIA_GUIDANCE[mediaType] ?? 'This is an archival family document.';
}

const UNCERTAINTY_RULES = `Wrong names and dates are worse than blanks. You MUST mark anything you cannot read with confidence instead of guessing:
- [illegible] for a word or passage you cannot read at all
- [?] immediately after a word you are unsure about
- [possibly Name] for a name you cannot read with certainty`;

function buildDraftPrompt(mediaType: string): string {
  return `You are helping organize a family history archive. ${mediaGuidance(mediaType)}

${UNCERTAINTY_RULES}

Analyze the image(s) and respond with ONLY a JSON object, no other text:
{
  "transcription_diplomatic": string | null,  // faithful transcription: original spelling, punctuation, and line breaks preserved, using the uncertainty markers above; null if the media has no text
  "transcription_normalized": string | null,  // the same text with modernized spelling and punctuation, search-friendly; null if the media has no text
  "title": string,                            // short descriptive title
  "description": string,                      // 1-2 sentence description
  "date": { "start": "YYYY-MM-DD" | null, "end": "YYYY-MM-DD" | null, "precision": "exact" | "month" | "year" | "decade" | "unknown" },
  "names": string[],                          // people named or depicted
  "documentType": string                      // e.g. "personal letter", "portrait photograph"
}
If the date is uncertain, estimate a range and choose the honest precision.`;
}

function buildVerifyPrompt(mediaType: string, draft: AiDraft): string {
  return `You are verifying a draft record for a family history archive. ${mediaGuidance(mediaType)}

Here is the draft produced by a first pass:
${JSON.stringify(draft)}

Re-examine the image(s) carefully. Check the transcription word-by-word against the visible text. Verify every name and date. Correct any errors you find, keeping or repairing the uncertainty markers [illegible], [?], and [possibly Name]. If the draft found no text, look again for any writing, captions, or inscriptions.

${UNCERTAINTY_RULES}

Respond with ONLY a JSON object, no other text: the full corrected record with the same keys as the draft, plus a "confidence" object:
{
  "transcription_diplomatic": string | null,
  "transcription_normalized": string | null,
  "title": string,
  "description": string,
  "date": { "start": "YYYY-MM-DD" | null, "end": "YYYY-MM-DD" | null, "precision": "exact" | "month" | "year" | "decade" | "unknown" },
  "names": string[],
  "documentType": string,
  "confidence": {
    "overall": "high" | "medium" | "low",
    "summary": string,                        // 1-2 sentences on transcription reliability
    "flaggedSpans": [ { "text": string, "reason": string } ]  // each uncertain span quoted from the diplomatic text; empty array if nothing is uncertain
  }
}`;
}

export async function transcribeDraft(
  client: VisionClient,
  images: Buffer[],
  mediaType: string
): Promise<AiDraft> {
  const text = await client.analyzeImages(images, buildDraftPrompt(mediaType));
  const parsed = extractJsonObject(text);
  const result = DraftSchema.safeParse(parsed);
  if (!result.success) throw new Error(`AI response invalid: ${result.error.message}`);
  return result.data;
}

export async function verifyTranscription(
  client: VisionClient,
  images: Buffer[],
  mediaType: string,
  draft: AiDraft
): Promise<AiVerified> {
  const text = await client.analyzeImages(images, buildVerifyPrompt(mediaType, draft));
  const parsed = extractJsonObject(text);
  const result = VerifiedSchema.safeParse(parsed);
  if (!result.success) throw new Error(`AI response invalid: ${result.error.message}`);
  return result.data;
}
