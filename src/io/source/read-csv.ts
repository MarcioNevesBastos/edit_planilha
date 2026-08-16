import Papa from 'papaparse';
import { createDataset, detectColumnTypes, normalizeCsvRows } from './dataset';
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
      message: 'A linha de origem contém campos preenchidos além do cabeçalho.',
      row: index + 2,
    })));

  if (extraFieldIssues.length > 0) {
    throw new SourceReadError(extraFieldIssues);
  }

  const indexedRows = parsedRows
    .map((row, index) => ({ row, sourceRowNumber: index + 2 }))
    .filter(({ row }) => row.some((value) => value !== ''));
  const rows = indexedRows.map(({ row }) => row.map((value) => value ?? null));

  const normalizedRows = normalizeCsvRows(rows);
  return createDataset(
    headerRow.map((value) => value ?? ''),
    normalizedRows,
    indexedRows.map(({ sourceRowNumber }) => sourceRowNumber),
    detectColumnTypes(headerRow, normalizedRows),
  );
}

async function parseCsv(
  file: File,
  options: Pick<ReadSourceOptions, 'delimiter'>,
): Promise<Papa.ParseResult<string[]>> {
  const delimiter = options.delimiter ?? await detectDelimiter(file);
  if (typeof FileReader === 'undefined') {
    return Papa.parse<string[]>(await file.text(), {
      delimiter,
      skipEmptyLines: false,
    });
  }

  return new Promise((resolve, reject) => {
    const data: string[][] = [];
    const errors: Papa.ParseError[] = [];
    let meta: Papa.ParseMeta = {
      delimiter: options.delimiter ?? '',
      linebreak: '',
      aborted: false,
      truncated: false,
      cursor: 0,
    };

    Papa.parse<string[]>(file, {
      delimiter,
      skipEmptyLines: false,
      chunkSize: BROWSER_CSV_CHUNK_SIZE,
      worker: Papa.WORKERS_SUPPORTED,
      chunk: (result) => {
        data.push(...result.data);
        errors.push(...result.errors);
        meta = result.meta;
      },
      complete: () => resolve({ data, errors, meta }),
      error: (error) => reject(new SourceReadError([{
        code: 'CsvReadFailure',
        message: error.message,
      }])),
    });
  });
}

async function detectDelimiter(file: File): Promise<string | undefined> {
  const sample = await file.slice(0, 64 * 1024).text();
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', ';', '\t', '|'];
  const ranked = candidates
    .map((candidate) => ({ candidate, score: delimiterCount(firstLine, candidate) }))
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.score ? ranked[0].candidate : undefined;
}

function delimiterCount(value: string, delimiter: string): number {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      count += 1;
    }
  }
  return count;
}
