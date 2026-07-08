import type { PersonRef } from '@shared/api.js';
import { parseAiNames, suggestibleNames } from './aiNames';

describe('parseAiNames', () => {
  it('parses JSON array', () => {
    expect(parseAiNames('["Mabel","Earl"]')).toEqual(['Mabel', 'Earl']);
  });

  it('null/invalid → []', () => {
    expect(parseAiNames(null)).toEqual([]);
    expect(parseAiNames('not json')).toEqual([]);
    expect(parseAiNames('{"a":1}')).toEqual([]);
    // Array with non-string elements is not an array of strings.
    expect(parseAiNames('["Mabel", 1]')).toEqual([]);
  });
});

describe('suggestibleNames', () => {
  it('filters already-linked (case-insensitive)', () => {
    const linked: PersonRef[] = [{ id: 1, name: 'mabel', role: 'subject' }];
    expect(suggestibleNames('["Mabel","Earl"]', linked)).toEqual(['Earl']);

    // Trimmed compare: whitespace around either side still matches.
    const padded: PersonRef[] = [{ id: 2, name: ' earl ', role: 'author' }];
    expect(suggestibleNames('["Earl","Mabel"]', padded)).toEqual(['Mabel']);
  });

  it('dedupes', () => {
    expect(suggestibleNames('["Ann","Ann"]', [])).toEqual(['Ann']);
  });
});
