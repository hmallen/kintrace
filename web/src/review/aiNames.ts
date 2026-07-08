import type { PersonRef } from '@shared/api.js';

/** Parse the raw `ai_names` JSON string; anything but an array of strings → []. */
export function parseAiNames(aiNames: string | null): string[] {
  if (aiNames === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(aiNames);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  if (!parsed.every((name): name is string => typeof name === 'string')) return [];
  return parsed;
}

/**
 * AI-extracted names not yet linked to the item: parsed `ai_names` minus any
 * name already in `linked` (case-insensitive, trimmed compare), de-duplicated.
 */
export function suggestibleNames(aiNames: string | null, linked: PersonRef[]): string[] {
  const linkedKeys = new Set(linked.map((p) => p.name.trim().toLowerCase()));
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const name of parseAiNames(aiNames)) {
    const key = name.trim().toLowerCase();
    if (key === '' || linkedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    suggestions.push(name);
  }
  return suggestions;
}
