import { describe, expect, it } from 'vitest';
import {
  buildDecorations,
  findFlaggedSpans,
  findUncertaintyMarkers,
  isSpanResolved,
} from './decorations';

describe('findFlaggedSpans', () => {
  it('matches all occurrences', () => {
    const text = 'the old mill by the old mill road';
    const matches = findFlaggedSpans(text, [{ text: 'old mill', reason: 'faded ink' }]);
    expect(matches).toEqual([
      { from: 4, to: 12, kind: 'flagged', reason: 'faded ink' },
      { from: 20, to: 28, kind: 'flagged', reason: 'faded ink' },
    ]);
  });

  it('no match when absent', () => {
    const text = 'a clean transcription';
    const matches = findFlaggedSpans(text, [{ text: 'smudged word', reason: 'smudge' }]);
    expect(matches).toEqual([]);
    expect(isSpanResolved(text, 'smudged word')).toBe(true);
  });

  it('empty span text ignored', () => {
    const text = 'some text';
    const matches = findFlaggedSpans(text, [{ text: '', reason: 'bogus' }]);
    expect(matches).toEqual([]);
  });
});

describe('findUncertaintyMarkers', () => {
  it('marker regex', () => {
    const text = 'the [illegible] farm [?] near [possibly Smith]';
    const matches = findUncertaintyMarkers(text);
    expect(matches).toEqual([
      { from: 4, to: 15, kind: 'marker', reason: 'illegible passage' },
      { from: 21, to: 24, kind: 'marker', reason: 'uncertain word' },
      { from: 30, to: 46, kind: 'marker', reason: 'uncertain name' },
    ]);
  });
});

describe('buildDecorations', () => {
  it('buildDecorations merges and sorts', () => {
    const text = 'went to [?] town yesterday';
    const decorations = buildDecorations(text, [
      { text: '[?] town', reason: 'unclear place name' },
    ]);
    expect(decorations).toEqual([
      { from: 8, to: 11, kind: 'marker', reason: 'uncertain word' },
      { from: 8, to: 16, kind: 'flagged', reason: 'unclear place name' },
    ]);
  });

  it('empty flaggedSpans', () => {
    const text = 'a note with [illegible] parts';
    const decorations = buildDecorations(text, []);
    expect(decorations).toEqual([
      { from: 12, to: 23, kind: 'marker', reason: 'illegible passage' },
    ]);
  });
});

describe('isSpanResolved', () => {
  it('resolved after edit', () => {
    const original = 'she wrote from [possibly Boston] that spring';
    const edited = 'she wrote from Boston that spring';
    expect(isSpanResolved(original, '[possibly Boston]')).toBe(false);
    expect(isSpanResolved(edited, '[possibly Boston]')).toBe(true);
  });
});
