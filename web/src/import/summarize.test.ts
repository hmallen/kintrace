import type { ImportResult } from '@shared/api.js';
import { summarizeImport } from './summarize';

describe('summarizeImport', () => {
  it('mixed results', () => {
    const results: ImportResult[] = [
      { path: 'fresh.jpg', itemId: 7, duplicate: false, mediaType: 'pdf', status: 'pending', autoSelected: true },
      { path: 'dupe.jpg', itemId: 3, duplicate: true, mediaType: 'photo', status: 'reviewed', autoSelected: false },
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
      { path: 'a.jpg', itemId: 1, duplicate: false, mediaType: 'pdf', status: 'pending', autoSelected: true },
      { path: 'b.jpg', itemId: 2, duplicate: false, mediaType: 'letter', status: 'pending', autoSelected: false },
      { path: 'c.jpg', itemId: 3, duplicate: false, mediaType: 'article', status: 'pending', autoSelected: false },
    ];
    expect(summarizeImport(results).line).toBe('3 imported, 0 already in archive, 0 failed');
  });

  it('empty', () => {
    expect(summarizeImport([]).line).toBe('0 imported, 0 already in archive, 0 failed');
  });
});
