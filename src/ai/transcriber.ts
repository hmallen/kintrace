import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

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

export function createAnthropicVisionClient(apiKey: string): VisionClient {
  const anthropic = new Anthropic({ apiKey });
  return {
    async analyzeImages(images, prompt) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              ...images.map((img) => ({
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'image/jpeg' as const,
                  data: img.toString('base64'),
                },
              })),
              { type: 'text' as const, text: prompt },
            ],
          },
        ],
      });
      const block = response.content.find((b) => b.type === 'text');
      return block && block.type === 'text' ? block.text : '';
    },
  };
}
