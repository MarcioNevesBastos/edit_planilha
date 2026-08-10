const MAX_SHEET_NAME_LENGTH = 31;
const ILLEGAL_SHEET_NAME_CHARACTERS = /[:\\/?*[\]\u0000-\u001f]/g;

export function uniqueSheetName(
  requestedName: string,
  occupiedNames: readonly string[],
): string {
  const base = sanitizeSheetName(requestedName) || 'Planilha';
  const occupied = new Set(occupiedNames.map(normalizeForComparison));
  const first = truncate(base, MAX_SHEET_NAME_LENGTH);
  if (!occupied.has(normalizeForComparison(first))) {
    return first;
  }

  for (let number = 2; ; number += 1) {
    const suffix = ` (${number})`;
    const candidate = `${truncate(base, MAX_SHEET_NAME_LENGTH - [...suffix].length)}${suffix}`;
    if (!occupied.has(normalizeForComparison(candidate))) {
      return candidate;
    }
  }
}

function sanitizeSheetName(name: string): string {
  return name
    .replace(/^'+|'+$/g, '')
    .replace(ILLEGAL_SHEET_NAME_CHARACTERS, ' ')
    .trim();
}

function truncate(value: string, length: number): string {
  return [...value].slice(0, length).join('').trimEnd();
}

function normalizeForComparison(value: string): string {
  return value.toLocaleUpperCase('en-US');
}
