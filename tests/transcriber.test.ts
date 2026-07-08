import { describe, it, expect } from 'vitest';
import { transcribeItem, type VisionClient } from '../src/ai/transcriber.js';

const goodResponse = JSON.stringify({
  transcription: 'Dear Mabel, the harvest is in...',
  title: 'Letter to Mabel about the harvest',
  description: 'A letter describing the 1943 harvest.',
  date: { start: '1943-09-01', end: null, precision: 'month' },
  names: ['Mabel Hutchins', 'Earl'],
  documentType: 'personal letter',
});

function fakeClient(response: string): VisionClient {
  return { analyzeImages: async () => response };
}

describe('transcribeItem', () => {
  it('parses a valid structured response', async () => {
    const result = await transcribeItem(fakeClient(goodResponse), [Buffer.from('img')], 'letter');
    expect(result.title).toBe('Letter to Mabel about the harvest');
    expect(result.names).toContain('Earl');
    expect(result.date.precision).toBe('month');
  });

  it('extracts JSON wrapped in prose or fences', async () => {
    const wrapped = 'Here is the analysis:\n```json\n' + goodResponse + '\n```';
    const result = await transcribeItem(fakeClient(wrapped), [Buffer.from('img')], 'letter');
    expect(result.title).toBe('Letter to Mabel about the harvest');
  });

  it('throws on schema-invalid responses', async () => {
    await expect(
      transcribeItem(fakeClient('{"nope": true}'), [Buffer.from('img')], 'letter')
    ).rejects.toThrow(/AI response invalid/);
  });

  it('tailors the prompt to the media type', async () => {
    let seenPrompt = '';
    const client: VisionClient = {
      analyzeImages: async (_imgs, prompt) => ((seenPrompt = prompt), goodResponse),
    };
    await transcribeItem(client, [Buffer.from('img')], 'letter');
    expect(seenPrompt).toMatch(/handwritten|letter/i);
  });

  it('extracts JSON despite a stray brace after it in prose', async () => {
    const noisy = 'Analysis: ' + goodResponse + ' Note the {handwriting} style.';
    const result = await transcribeItem(fakeClient(noisy), [Buffer.from('img')], 'letter');
    expect(result.title).toBe('Letter to Mabel about the harvest');
  });

  it('extracts JSON despite a stray brace pair before it in prose', async () => {
    const noisy = 'The {image} shows a letter.\n' + goodResponse;
    const result = await transcribeItem(fakeClient(noisy), [Buffer.from('img')], 'letter');
    expect(result.title).toBe('Letter to Mabel about the harvest');
  });

  it('throws when no braces ever form valid JSON', async () => {
    await expect(
      transcribeItem(
        fakeClient('The {handwriting} is {faded}'),
        [Buffer.from('img')],
        'letter'
      )
    ).rejects.toThrow(/AI response invalid/);
  });
});
