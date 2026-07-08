import { describe, it, expect } from 'vitest';
import {
  transcribeDraft,
  verifyTranscription,
  type AiDraft,
  type VisionClient,
} from '../src/ai/transcriber.js';

function fakeClient(response: string): VisionClient {
  return { analyzeImages: async () => response };
}

const draftFields = {
  transcription_diplomatic: 'Dear Mabel, the har-\nvest is in. Yrs truly, [possibly Earl]',
  transcription_normalized: 'Dear Mabel, the harvest is in. Yours truly, Earl.',
  title: 'Letter to Mabel about the harvest',
  description: 'A letter describing the 1943 harvest.',
  date: { start: '1943-09-01', end: null, precision: 'month' },
  names: ['Mabel Hutchins', 'Earl'],
  documentType: 'personal letter',
};

const draftResponse = JSON.stringify(draftFields);

const sampleDraft: AiDraft = JSON.parse(draftResponse);

const verifiedResponse = JSON.stringify({
  ...draftFields,
  names: ['Mabel Hutchins', 'Earl Hutchins'],
  confidence: {
    overall: 'medium',
    summary: 'Most of the letter is legible; the signature is uncertain.',
    flaggedSpans: [{ text: '[possibly Earl]', reason: 'signature is smudged' }],
  },
});

describe('transcribeDraft', () => {
  it('parses a valid dual-transcription response', async () => {
    const result = await transcribeDraft(fakeClient(draftResponse), [Buffer.from('img')], 'letter');
    expect(result.transcription_diplomatic).toContain('[possibly Earl]');
    expect(result.transcription_normalized).toBe(
      'Dear Mabel, the harvest is in. Yours truly, Earl.'
    );
    expect(result.title).toBe('Letter to Mabel about the harvest');
    expect(result.date.precision).toBe('month');
  });

  it('extracts JSON wrapped in prose or fences', async () => {
    const wrapped = 'Here is the analysis:\n```json\n' + draftResponse + '\n```';
    const result = await transcribeDraft(fakeClient(wrapped), [Buffer.from('img')], 'letter');
    expect(result.transcription_diplomatic).toContain('Dear Mabel');
  });

  it('mandates uncertainty markers and both transcription fields in the prompt', async () => {
    let seenPrompt = '';
    const client: VisionClient = {
      analyzeImages: async (_imgs, prompt) => ((seenPrompt = prompt), draftResponse),
    };
    await transcribeDraft(client, [Buffer.from('img')], 'letter');
    expect(seenPrompt).toContain('[illegible]');
    expect(seenPrompt).toContain('[?]');
    expect(seenPrompt).toContain('[possibly Name]');
    expect(seenPrompt).toContain('transcription_diplomatic');
    expect(seenPrompt).toContain('transcription_normalized');
  });

  it('rejects a response missing transcription_normalized', async () => {
    const missing: Record<string, unknown> = { ...draftFields };
    delete missing.transcription_normalized;
    await expect(
      transcribeDraft(fakeClient(JSON.stringify(missing)), [Buffer.from('img')], 'letter')
    ).rejects.toThrow(/AI response invalid/);
  });

  it('extracts JSON despite stray braces around it in prose', async () => {
    const after = 'Analysis: ' + draftResponse + ' Note the {handwriting} style.';
    const before = 'The {image} shows a letter.\n' + draftResponse;
    for (const noisy of [after, before]) {
      const result = await transcribeDraft(fakeClient(noisy), [Buffer.from('img')], 'letter');
      expect(result.title).toBe('Letter to Mabel about the harvest');
    }
  });

  it('throws when no braces ever form valid JSON', async () => {
    await expect(
      transcribeDraft(fakeClient('The {handwriting} is {faded}'), [Buffer.from('img')], 'letter')
    ).rejects.toThrow(/AI response invalid/);
  });
});

describe('verifyTranscription', () => {
  it('embeds the draft JSON in the prompt and parses the corrected response', async () => {
    let seenPrompt = '';
    const client: VisionClient = {
      analyzeImages: async (_imgs, prompt) => ((seenPrompt = prompt), verifiedResponse),
    };
    const result = await verifyTranscription(client, [Buffer.from('img')], 'letter', sampleDraft);
    expect(seenPrompt).toContain('Letter to Mabel about the harvest');
    expect(result.names).toContain('Earl Hutchins');
    expect(result.confidence.overall).toBe('medium');
    expect(result.confidence.flaggedSpans).toEqual([
      { text: '[possibly Earl]', reason: 'signature is smudged' },
    ]);
  });

  it('rejects a response whose confidence.overall is not high/medium/low', async () => {
    const bad = JSON.stringify({
      ...draftFields,
      confidence: { overall: 'certain', summary: 'All good.', flaggedSpans: [] },
    });
    await expect(
      verifyTranscription(fakeClient(bad), [Buffer.from('img')], 'letter', sampleDraft)
    ).rejects.toThrow(/AI response invalid/);
  });
});
