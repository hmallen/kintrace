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

export async function transcribeItem(
  client: VisionClient,
  images: Buffer[],
  mediaType: string
): Promise<AiSuggestion> {
  const text = await client.analyzeImages(images, buildPrompt(mediaType));
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI response invalid: no JSON object found');
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`AI response invalid: ${(e as Error).message}`);
  }
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
