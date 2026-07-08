import { describe, it, expect } from 'vitest';
import { createLlmVisionEngine } from '../src/ai/engine.js';
import type { VisionClient } from '../src/ai/transcriber.js';

const pass1Response = JSON.stringify({
  transcription_diplomatic: 'Dear Mabel, the harvest is in. Yrs, [possibly Earl]',
  transcription_normalized: 'Dear Mabel, the harvest is in. Yours, Earl.',
  title: 'Letter to Mabel',
  description: 'A letter describing the 1943 harvest.',
  date: { start: '1943-09-01', end: null, precision: 'month' },
  names: ['Mabel Hutchins', 'Earl'],
  documentType: 'personal letter',
});

const pass2Response = JSON.stringify({
  transcription_diplomatic: 'Dear Mabel, the harvest is in. Yrs, Earl Hutchins',
  transcription_normalized: 'Dear Mabel, the harvest is in. Yours, Earl Hutchins.',
  title: 'Letter to Mabel about the 1943 harvest',
  description: 'A letter from Earl Hutchins describing the 1943 harvest.',
  date: { start: '1943-09-01', end: '1943-09-30', precision: 'month' },
  names: ['Mabel Hutchins', 'Earl Hutchins'],
  documentType: 'personal letter',
  confidence: {
    overall: 'high',
    summary: 'The signature reads clearly as Earl Hutchins on re-examination.',
    flaggedSpans: [],
  },
});

function scriptedClient(responses: (string | Error)[]) {
  const calls: string[] = [];
  const client: VisionClient = {
    analyzeImages: async (_imgs, prompt) => {
      calls.push(prompt);
      const next = responses.shift();
      if (next === undefined) throw new Error('scripted client exhausted');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client, calls };
}

describe('createLlmVisionEngine', () => {
  it('runs both passes and returns the pass-2 values with confidence', async () => {
    const { client, calls } = scriptedClient([pass1Response, pass2Response]);
    const engine = createLlmVisionEngine(client);

    const result = await engine.transcribe([Buffer.from('img')], 'letter');

    expect(calls).toHaveLength(2);
    expect(result.transcriptionDiplomatic).toBe(
      'Dear Mabel, the harvest is in. Yrs, Earl Hutchins'
    );
    expect(result.transcriptionNormalized).toBe(
      'Dear Mabel, the harvest is in. Yours, Earl Hutchins.'
    );
    expect(result.title).toBe('Letter to Mabel about the 1943 harvest');
    expect(result.names).toContain('Earl Hutchins');
    expect(result.date).toEqual({ start: '1943-09-01', end: '1943-09-30', precision: 'month' });
    expect(result.documentType).toBe('personal letter');
    expect(result.confidence.overall).toBe('high');
    expect(result.confidence.flaggedSpans).toEqual([]);
  });

  it('propagates a failure from the second pass after two attempted calls', async () => {
    const { client, calls } = scriptedClient([pass1Response, new Error('vision API down')]);
    const engine = createLlmVisionEngine(client);

    await expect(engine.transcribe([Buffer.from('img')], 'letter')).rejects.toThrow(
      'vision API down'
    );
    expect(calls).toHaveLength(2);
  });

  it('rejects when the second pass returns schema-invalid JSON', async () => {
    const { client } = scriptedClient([pass1Response, '{"nope": true}']);
    const engine = createLlmVisionEngine(client);

    await expect(engine.transcribe([Buffer.from('img')], 'letter')).rejects.toThrow(
      /AI response invalid/
    );
  });
});
