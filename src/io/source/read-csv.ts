import Papa from 'papaparse';
import { createDataset, detectColumnTypes } from './dataset';
import { SourceReadError, type ReadSourceOptions } from './types';

const BROWSER_CSV_CHUNK_SIZE = 256 * 1024;

export async function readCsv(file: File, options: Pick<ReadSourceOptions, 'delimiter'> = {}) {
  const result = await parseCsv(file, options);

  const parsingErrors = result.errors.filter((error) => error.code !== 'UndetectableDelimiter');

  if (parsingErrors.length > 0) {
    throw new SourceReadError(parsingErrors.map((error) => ({
      code: error.code,
      message: error.message,
      row: error.row === undefined ? undefined : error.row + 1,
    })));
  }

  const [headerRow = [], ...parsedRows] = result.data;
  const extraFieldIssues = parsedRows.flatMap((row, index) => row
    .slice(headerRow.length)
    .filter((value) => value !== '')
    .map(() => ({
      code: 'TooManyFields',
      message: 'Source row contains populated fields beyond the header row',
      row: index + 2,
    })));

  if (extraFieldIssues.length > 0) {
    throw new SourceReadError(extraFieldIssues);
  }

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

async function parseCsv(
  file: File,
  options: Pick<ReadSourceOptions, 'delimiter'>,
): Promise<Papa.ParseResult<string[]>> {
  if (typeof FileReader === 'undefined') {
    return Papa.parse<string[]>(await file.text(), {
      delimiter: options.delimiter,
      skipEmptyLines: false,
    });
  }

  return new Promise((resolve, reject) => {
    const data: string[][] = [];
    const errors: Papa.ParseError[] = [];

    Papa.parse<string[]>(file, {
      delimiter: options.delimiter,
      skipEmptyLines: false,
      chunkSize: BROWSER_CSV_CHUNK_SIZE,
      worker: Papa.WORKERS_SUPPORTED,
      chunk: (result) => {
        data.push(...result.data);
        errors.push(...result.errors);
      },
      complete: () => resolve({ data, errors, meta: {} }),
      error: (error) => reject(new SourceReadError([{
        code: 'CsvReadFailure',
        message: error.message,
      }])),
    });
  });
}
