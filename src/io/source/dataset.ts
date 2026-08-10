import { makeColumnId } from '../../domain/dataset/column-id';
import type { CellValue, Dataset, DatasetColumn } from '../../domain/dataset/types';

export function createDataset(
  headerRow: readonly CellValue[],
  dataRows: readonly (readonly CellValue[])[],
  sourceRowNumbers: readonly number[],
  detectedTypes?: readonly DatasetColumn['detectedType'][],
): Dataset {
  const headerOccurrences = new Map<string, number>();
  const columns = headerRow.map((value, sourceIndex) => {
    const header = value === null ? '' : String(value);
    const headerKey = makeColumnId(header, 0).replace(/__1$/, '');
    const occurrence = headerOccurrences.get(headerKey) ?? 0;
    headerOccurrences.set(headerKey, occurrence + 1);

    return {
      id: makeColumnId(header, occurrence),
      header,
      sourceIndex,
      detectedType: detectedTypes?.[sourceIndex] ?? 'empty',
    } satisfies DatasetColumn;
  });

  const rows = dataRows.map((sourceValues, rowIndex) => {
    const values = Object.fromEntries(columns.map((column) => [
      column.id,
      sourceValues[column.sourceIndex] ?? null,
    ])) as Record<string, CellValue>;

    return {
      rowId: `row-${sourceRowNumbers[rowIndex]}`,
      sourceRowNumber: sourceRowNumbers[rowIndex],
      values,
      originalValues: { ...values },
    };
  });

  return { columns, rows };
}

export function detectColumnTypes(
  headerRow: readonly CellValue[],
  dataRows: readonly (readonly CellValue[])[],
): DatasetColumn['detectedType'][] {
  return headerRow.map((_, columnIndex) => {
    const types = new Set(dataRows
      .map((row) => row[columnIndex])
      .filter((value): value is Exclude<CellValue, null> => value !== null && value !== '')
      .map((value) => typeof value === 'number'
        ? 'number'
        : typeof value === 'boolean'
          ? 'boolean'
          : 'string'));

    if (types.size === 0) {
      return 'empty';
    }

    return types.size === 1
      ? [...types][0] as DatasetColumn['detectedType']
      : 'mixed';
  });
}
