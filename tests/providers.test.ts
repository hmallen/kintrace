import { describe, it, expect } from 'vitest';
import {
  createOpenAIVisionClient,
  resolveProvider,
  type OpenAiResponsesLike,
} from '../src/ai/providers.js';

type CreateRequest = Parameters<OpenAiResponsesLike['responses']['create']>[0];

function fakeSdk(outputText: string): { sdk: OpenAiResponsesLike; requests: CreateRequest[] } {
  const requests: CreateRequest[] = [];
  return {
    requests,
    sdk: {
      responses: {
        create: async (request) => {
          requests.push(request);
          return { output_text: outputText };
        },
      },
    },
  };
}

describe('createOpenAIVisionClient', () => {
  it('sends one user message with image parts followed by the prompt text', async () => {
    const { sdk, requests } = fakeSdk('the transcription');
    const client = createOpenAIVisionClient('sk-test', { sdk });
    const images = [Buffer.from('first image'), Buffer.from('second image')];

    const result = await client.analyzeImages(images, 'Transcribe this letter.');

    expect(result).toBe('the transcription');
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.max_output_tokens).toBe(8192);
    expect(request.input).toHaveLength(1);
    const message = request.input[0];
    expect(message.role).toBe('user');
    expect(message.content).toHaveLength(3);

    for (let i = 0; i < images.length; i++) {
      const part = message.content[i];
      expect(part.type).toBe('input_image');
      if (part.type !== 'input_image') throw new Error('unreachable');
      expect(part.image_url).toMatch(/^data:image\/jpeg;base64,/);
      expect(part.image_url).toBe(`data:image/jpeg;base64,${images[i].toString('base64')}`);
    }

    const last = message.content[2];
    expect(last).toEqual({ type: 'input_text', text: 'Transcribe this letter.' });
  });

  it('uses gpt-5.5 by default', async () => {
    const { sdk, requests } = fakeSdk('ok');
    const client = createOpenAIVisionClient('sk-test', { sdk });
    await client.analyzeImages([Buffer.from('img')], 'prompt');
    expect(requests[0].model).toBe('gpt-5.5');
  });

  it('uses the model override when provided', async () => {
    const { sdk, requests } = fakeSdk('ok');
    const client = createOpenAIVisionClient('sk-test', { sdk, model: 'gpt-5.5-mini' });
    await client.analyzeImages([Buffer.from('img')], 'prompt');
    expect(requests[0].model).toBe('gpt-5.5-mini');
  });
});

describe('resolveProvider', () => {
  it('defaults to openai when TRANSCRIBE_PROVIDER is unset', () => {
    expect(resolveProvider({ OPENAI_API_KEY: 'sk-openai' })).toEqual({
      ok: true,
      provider: 'openai',
      apiKey: 'sk-openai',
    });
  });

  it('selects openai explicitly', () => {
    expect(
      resolveProvider({ TRANSCRIBE_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-openai' })
    ).toEqual({ ok: true, provider: 'openai', apiKey: 'sk-openai' });
  });

  it('selects anthropic explicitly', () => {
    expect(
      resolveProvider({ TRANSCRIBE_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant' })
    ).toEqual({ ok: true, provider: 'anthropic', apiKey: 'sk-ant' });
  });

  it('reports a missing OpenAI key by name', () => {
    expect(resolveProvider({})).toEqual({
      ok: false,
      message: 'AI transcription disabled: TRANSCRIBE_PROVIDER=openai but OPENAI_API_KEY is not set',
    });
  });

  it('reports a missing Anthropic key by name', () => {
    expect(resolveProvider({ TRANSCRIBE_PROVIDER: 'anthropic' })).toEqual({
      ok: false,
      message:
        'AI transcription disabled: TRANSCRIBE_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set',
    });
  });

  it('rejects unknown providers without throwing', () => {
    expect(resolveProvider({ TRANSCRIBE_PROVIDER: 'gemini' })).toEqual({
      ok: false,
      message: 'AI transcription disabled: unknown TRANSCRIBE_PROVIDER "gemini" (use openai or anthropic)',
    });
  });
});
