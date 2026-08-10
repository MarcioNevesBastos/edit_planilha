import * as XLSX from 'xlsx';
import { makeColumnId } from '../../domain/dataset/column-id';
import type { CellValue, Dataset, DatasetColumn } from '../../domain/dataset/types';

export function extractDestinationDataset(
  buffer: ArrayBuffer,
  sheetName: string,
  rangeReference: string,
): Dataset {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, cellText: true });
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) throw new Error(`Aba do modelo não encontrada: ${sheetName}`);
  const range = XLSX.utils.decode_range(rangeReference.replace(/\$/g, ''));
  const headers = Array.from({ length: range.e.c - range.s.c + 1 }, (_, offset) => {
    const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c + offset })];
    return cell?.w ?? String(cell?.v ?? `Coluna ${XLSX.utils.encode_col(range.s.c + offset)}`);
  });
  const rawRows = Array.from({ length: Math.max(0, range.e.r - range.s.r) }, (_, rowOffset) => {
    const worksheetRow = range.s.r + rowOffset + 1;
    return Array.from({ length: headers.length }, (_, columnOffset) => {
      const cell = worksheet[XLSX.utils.encode_cell({ r: worksheetRow, c: range.s.c + columnOffset })];
      return destinationCellValue(cell);
    });
  });
  const columns = headers.map((header, index): DatasetColumn => ({
    id: makeColumnId(header, index),
    header,
    sourceIndex: range.s.c + index,
    detectedType: columnType(rawRows.map((row) => row[index])),
  }));
  const rows = rawRows
    .map((values, index) => ({ values, sourceRowNumber: range.s.r + index + 2 }))
    .filter(({ values }) => values.some((value) => value !== null && value !== ''))
    .map(({ values, sourceRowNumber }) => {
      const record = Object.fromEntries(columns.map((column, index) => [column.id, values[index]]));
      return {
        rowId: `template-${sourceRowNumber}`,
        sourceRowNumber,
        values: record,
        originalValues: { ...record },
      };
    });
  return { columns, rows };
}

function destinationCellValue(cell: XLSX.CellObject | undefined): CellValue {
  if (!cell || cell.v === undefined || cell.v === null) return null;
  if (cell.t === 'n') return cell.v as number;
  if (cell.t === 'b') return Boolean(cell.v);
  return cell.w ?? String(cell.v);
}

function columnType(values: readonly CellValue[]): DatasetColumn['detectedType'] {
  const types = new Set(values.flatMap((value) => {
    if (value === null || value === '') return [];
    if (typeof value === 'number') return ['number' as const];
    if (typeof value === 'boolean') return ['boolean' as const];
    return ['string' as const];
  }));
  return types.size === 0 ? 'empty' : types.size === 1 ? [...types][0] : 'mixed';
}
