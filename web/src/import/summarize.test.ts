import type { ImportResult } from '@shared/api.js';
import { summarizeImport } from './summarize';

describe('summarizeImport', () => {
  it('mixed results', () => {
    const results: ImportResult[] = [
      { path: 'fresh.jpg', itemId: 7, duplicate: false },
      { path: 'dupe.jpg', itemId: 3, duplicate: true },
      { path: 'broken.jpg', error: 'x' },
    ];
    expect(summarizeImport(results)).toEqual({
      imported: 1,
      duplicates: 1,
      failed: 1,
      line: '1 imported, 1 already in archive, 1 failed',
    });
  });

  it('all imported', () => {
    const results: ImportResult[] = [
      { path: 'a.jpg', itemId: 1, duplicate: false },
      { path: 'b.jpg', itemId: 2, duplicate: false },
      { path: 'c.jpg', itemId: 3, duplicate: false },
    ];
    expect(summarizeImport(results).line).toBe('3 imported, 0 already in archive, 0 failed');
  });

  it('empty', () => {
    expect(summarizeImport([]).line).toBe('0 imported, 0 already in archive, 0 failed');
  });
});
