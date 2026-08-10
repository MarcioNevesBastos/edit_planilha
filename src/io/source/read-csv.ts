import Papa from 'papaparse';
import { createDataset, detectColumnTypes } from './dataset';
import { SourceReadError, type ReadSourceOptions } from './types';

export async function readCsv(file: File, options: Pick<ReadSourceOptions, 'delimiter'> = {}) {
  const csv = (await file.text()).replace(/^\uFEFF/, '');
  const result = Papa.parse<string[]>(csv, {
    delimiter: options.delimiter,
    skipEmptyLines: false,
  });

  const parsingErrors = result.errors.filter((error) => error.code !== 'UndetectableDelimiter');

  if (parsingErrors.length > 0) {
    throw new SourceReadError(parsingErrors.map((error) => ({
      code: error.code,
      message: error.message,
      row: error.row === undefined ? undefined : error.row + 1,
    })));
  }

  const [headerRow = [], ...parsedRows] = result.data;
  const indexedRows = parsedRows
    .map((row, index) => ({ row, sourceRowNumber: index + 2 }))
    .filter(({ row }) => row.some((value) => value !== ''));
  const rows = indexedRows.map(({ row }) => row.map((value) => value ?? null));

  return createDataset(
    headerRow.map((value) => value ?? ''),
    rows,
    indexedRows.map(({ sourceRowNumber }) => sourceRowNumber),
    detectColumnTypes(headerRow, rows),
  );
}
