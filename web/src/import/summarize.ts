import type { ImportResult } from '@shared/api.js';

export interface ImportSummary {
  imported: number;
  duplicates: number;
  failed: number;
  line: string;
}

export function summarizeImport(results: ImportResult[]): ImportSummary {
  let imported = 0;
  let duplicates = 0;
  let failed = 0;
  for (const result of results) {
    if ('error' in result) {
      failed += 1;
    } else if (result.duplicate) {
      duplicates += 1;
    } else {
      imported += 1;
    }
  }
  return {
    imported,
    duplicates,
    failed,
    line: `${imported} imported, ${duplicates} already in archive, ${failed} failed`,
  };
}
