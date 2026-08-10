export function makeColumnId(header: string, ordinal: number): string {
  const slug = header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'column';

  return `${slug}__${ordinal + 1}`;
}
