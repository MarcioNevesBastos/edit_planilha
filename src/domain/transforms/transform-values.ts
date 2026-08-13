import type { CellValue, Dataset, DatasetColumn } from '../dataset/types';

function valueKey(value: CellValue): string {
  return value === null || value === '' ? 'empty' : JSON.stringify([typeof value, value]);
}

export function getDistinctColumnValues(dataset: Dataset, columnId: string, limit = 500): CellValue[] {
  if (!dataset.columns.some((column) => column.id === columnId)) {
    throw new RangeError(`Unknown column: ${columnId}`);
  }

  const values: CellValue[] = [];
  const seen = new Set<string>();
  for (const row of dataset.rows) {
    const value = row.values[columnId] ?? null;
    const key = valueKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value === '' ? null : value);
    if (values.length >= limit) break;
  }
  return values;
}

function parseNumberInput(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed;
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new TypeError('Valor inválido para número.');
  return value;
}

export function parseCellValueInput(input: string, column: DatasetColumn): CellValue {
  if (input.trim() === '') return null;
  switch (column.detectedType) {
    case 'number': return parseNumberInput(input);
    case 'boolean': {
      const normalized = input.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
      throw new TypeError('Valor inválido para booleano.');
    }
    default: return input;
  }
}

export function displayCellValue(value: CellValue): string {
  return value === null || value === '' ? 'Vazio' : String(value);
}

function columnTextValues(dataset: Dataset, columnId: string): string[] {
  if (!dataset.columns.some((column) => column.id === columnId)) {
    throw new RangeError(`Unknown column: ${columnId}`);
  }
  return dataset.rows
    .map((row) => row.values[columnId])
    .filter((value): value is string => typeof value === 'string' && value !== '');
}

export function getSuggestedDelimiters(dataset: Dataset, columnId: string): string[] {
  const candidates = [';', ',', '|', '\t', '/', '-', ' '];
  const values = columnTextValues(dataset, columnId);
  return candidates
    .map((delimiter, index) => ({ delimiter, index, count: values.reduce((total, value) => total + value.split(delimiter).length - 1, 0) }))
    .filter(({ count }) => count > 0)
    .sort((left, right) => right.count - left.count || left.index - right.index)
    .map(({ delimiter }) => delimiter);
}

export function detectDateFormats(dataset: Dataset, columnId: string): Array<'dd/MM/yyyy' | 'yyyy-MM-dd'> {
  const formats: Array<'dd/MM/yyyy' | 'yyyy-MM-dd'> = [];
  for (const value of columnTextValues(dataset, columnId)) {
    const format = /^\d{2}\/\d{2}\/\d{4}$/.test(value)
      ? 'dd/MM/yyyy'
      : /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? 'yyyy-MM-dd'
        : null;
    if (format && !formats.includes(format)) formats.push(format);
  }
  return formats;
}

export function detectDecimalSeparator(dataset: Dataset, columnId: string): '.' | ',' {
  const values = columnTextValues(dataset, columnId);
  const commaCount = values.filter((value) => /,\d+$/.test(value)).length;
  const dotCount = values.filter((value) => /\.\d+$/.test(value)).length;
  return commaCount > dotCount ? ',' : '.';
}
