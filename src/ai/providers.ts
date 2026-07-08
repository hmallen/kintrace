import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { VisionClient } from './transcriber.js';

type OpenAiContentPart =
  | { type: 'input_image'; image_url: string; detail: 'auto' }
  | { type: 'input_text'; text: string };

interface OpenAiCreateRequest {
  model: string;
  max_output_tokens: number;
  input: Array<{ role: 'user'; content: OpenAiContentPart[] }>;
}

/** The minimal slice of the OpenAI SDK the vision client calls — the test seam. */
export interface OpenAiResponsesLike {
  responses: {
    create(request: OpenAiCreateRequest): Promise<{ output_text: string }>;
  };
}

function createRealOpenAiSdk(apiKey: string): OpenAiResponsesLike {
  const openai = new OpenAI({ apiKey });
  return {
    responses: {
      async create(request) {
        return openai.responses.create(request);
      },
    },
  };
}

export function createOpenAIVisionClient(
  apiKey: string,
  opts: { model?: string; sdk?: OpenAiResponsesLike } = {}
): VisionClient {
  const sdk = opts.sdk ?? createRealOpenAiSdk(apiKey);
  const model = opts.model ?? 'gpt-5.5';
  return {
    async analyzeImages(images, prompt) {
      const response = await sdk.responses.create({
        model,
        max_output_tokens: 8192,
        input: [
          {
            role: 'user',
            content: [
              ...images.map(
                (img): OpenAiContentPart => ({
                  type: 'input_image',
                  image_url: `data:image/jpeg;base64,${img.toString('base64')}`,
                  detail: 'auto',
                })
              ),
              { type: 'input_text', text: prompt },
            ],
          },
        ],
      });
      return response.output_text;
    },
  };
}

export function createAnthropicVisionClient(apiKey: string): VisionClient {
  const anthropic = new Anthropic({ apiKey });
  return {
    async analyzeImages(images, prompt) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 8192,
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

export type ProviderChoice =
  | { ok: true; provider: 'openai' | 'anthropic'; apiKey: string }
  | { ok: false; message: string };

export function resolveProvider(env: Record<string, string | undefined>): ProviderChoice {
  const provider = env.TRANSCRIBE_PROVIDER ?? 'openai';
  if (provider === 'openai') {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        message:
          'AI transcription disabled: TRANSCRIBE_PROVIDER=openai but OPENAI_API_KEY is not set',
      };
    }
    return { ok: true, provider: 'openai', apiKey };
  }
  if (provider === 'anthropic') {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        message:
          'AI transcription disabled: TRANSCRIBE_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set',
      };
    }
    return { ok: true, provider: 'anthropic', apiKey };
  }
  return {
    ok: false,
    message: `AI transcription disabled: unknown TRANSCRIBE_PROVIDER "${provider}" (use openai or anthropic)`,
  };
}
