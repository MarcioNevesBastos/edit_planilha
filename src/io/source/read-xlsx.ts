import * as XLSX from 'xlsx';
import { createDataset } from './dataset';
import { SourceReadError, type ReadSourceOptions } from './types';
import type { CellValue, DatasetColumn } from '../../domain/dataset/types';

export async function listXlsxSheets(file: File): Promise<string[]> {
  return (await readWorkbook(file)).SheetNames;
}

export async function readXlsx(
  file: File,
  options: Pick<ReadSourceOptions, 'sheetName'> = {},
) {
  const workbook = await readWorkbook(file);
  const sheetName = options.sheetName ?? workbook.SheetNames[0];

  if (!sheetName || !workbook.Sheets[sheetName]) {
    throw new SourceReadError([{
      code: 'MissingSheet',
      message: `Source sheet not found: ${sheetName ?? ''}`,
    }]);
  }

  const worksheet = workbook.Sheets[sheetName];
  const rangeReference = worksheet['!ref'];

  if (!rangeReference) {
    return createDataset([], [], []);
  }

  const range = XLSX.utils.decode_range(rangeReference);
  const matrix = Array.from(
    { length: range.e.r - range.s.r + 1 },
    (_, relativeRow) => Array.from(
      { length: range.e.c - range.s.c + 1 },
      (_, relativeColumn) => cellValue(worksheet[XLSX.utils.encode_cell({
        r: range.s.r + relativeRow,
        c: range.s.c + relativeColumn,
      })]),
    ),
  );
  const [headerRow = [], ...sourceRows] = matrix;
  const indexedRows = sourceRows
    .map((row, index) => ({
      row,
      sourceRowNumber: range.s.r + index + 2,
    }))
    .filter(({ row }) => row.some((value) => value !== null && value !== ''));

  return createDataset(
    headerRow,
    indexedRows.map(({ row }) => row),
    indexedRows.map(({ sourceRowNumber }) => sourceRowNumber),
    detectXlsxColumnTypes(worksheet, range),
  );
}

async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  try {
    return XLSX.read(await file.arrayBuffer(), {
      type: 'array',
      cellDates: false,
      cellNF: true,
      cellText: true,
    });
  } catch (error) {
    throw new SourceReadError([{
      code: 'InvalidWorkbook',
      message: error instanceof Error ? error.message : 'Unable to read source workbook',
    }]);
  }
}

function cellValue(cell: XLSX.CellObject | undefined): CellValue {
  if (!cell || cell.v === undefined || cell.v === null) {
    return null;
  }

  if (cell.t === 'n') {
    return isDateCell(cell) ? cell.w ?? String(cell.v) : cell.v as number;
  }

  if (cell.t === 'b') {
    return Boolean(cell.v);
  }

  return cell.w ?? String(cell.v);
}

function detectXlsxColumnTypes(
  worksheet: XLSX.WorkSheet,
  range: XLSX.Range,
): DatasetColumn['detectedType'][] {
  return Array.from({ length: range.e.c - range.s.c + 1 }, (_, relativeColumn) => {
    const types = new Set<Exclude<DatasetColumn['detectedType'], 'mixed' | 'empty'>>();

    for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: range.s.c + relativeColumn })];

      if (!cell || cell.v === undefined || cell.v === null || cell.v === '') {
        continue;
      }

      types.add(cell.t === 'n'
        ? isDateCell(cell) ? 'date' : 'number'
        : cell.t === 'b' ? 'boolean' : 'string');
    }

    return types.size === 0
      ? 'empty'
      : types.size === 1
        ? [...types][0]
        : 'mixed';
  });
}

function isDateCell(cell: XLSX.CellObject): boolean {
  return cell.t === 'n' && typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z);
}
