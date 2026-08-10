import type { CellValue } from '../../domain/dataset/types';
import { uniqueSheetName } from '../../utils/sheet-name';
import type { OoxmlPackage } from './ooxml-package';
import { indexWorkbook } from './workbook-index';

const WORKSHEET_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const WORKSHEET_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const REJECTED_SHEET_NAME = 'Registros rejeitados';

export interface RejectedSheetRow {
  sourceRowNumber: number;
  originalRelevantFields: Readonly<Record<string, CellValue>>;
  errorField: string;
  invalidValue: CellValue;
  rejectionReason: string;
  failedRuleOrTransform: string;
}

export interface RejectedSheetProgress {
  completed: number;
  total: number;
}

export interface RejectedSheetOptions {
  batchSize: number;
  onProgress(progress: RejectedSheetProgress): Promise<void> | void;
}

export async function addRejectedSheet(
  pkg: OoxmlPackage,
  rows: readonly RejectedSheetRow[],
  options?: RejectedSheetOptions,
): Promise<string> {
  const index = await indexWorkbook(pkg);
  const sheetName = uniqueSheetName(
    REJECTED_SHEET_NAME,
    index.sheets.map(({ name }) => name),
  );
  const sheetId = nextNumber(index.sheets.map(({ sheetId }) => sheetId));
  const relationshipId = `rId${nextNumber(index.relationships.map(({ id }) => id))}`;
  const workbookDirectory = partDirectory(index.workbookPath);
  const worksheetNumber = nextWorksheetNumber(pkg, workbookDirectory);
  const worksheetTarget = `worksheets/sheet${worksheetNumber}.xml`;
  const worksheetPath = `${workbookDirectory}/${worksheetTarget}`;
  const relationshipsPath = relationshipPartPath(index.workbookPath);
  if (options && (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1)) {
    throw new RangeError('batchSize must be a positive whole number');
  }
  const worksheet = await rejectedWorksheet(rows, options);
  const workbook = appendBeforeClosingTag(
    decode(pkg.readPart(index.workbookPath)),
    'sheets',
    `<sheet name="${escapeXml(sheetName)}" sheetId="${sheetId}" r:id="${relationshipId}"/>`,
  );
  const relationships = appendBeforeClosingTag(
    decode(pkg.readPart(relationshipsPath)),
    'Relationships',
    `<Relationship Id="${relationshipId}" Type="${WORKSHEET_RELATIONSHIP}" Target="${worksheetTarget}"/>`,
  );
  const contentTypes = appendBeforeClosingTag(
    decode(pkg.readPart('[Content_Types].xml')),
    'Types',
    `<Override PartName="/${worksheetPath}" ContentType="${WORKSHEET_CONTENT_TYPE}"/>`,
  );

  pkg.addPart(worksheetPath, worksheet);
  pkg.updatePart(index.workbookPath, workbook);
  pkg.updatePart(relationshipsPath, relationships);
  pkg.updatePart('[Content_Types].xml', contentTypes);

  return sheetName;
}

async function rejectedWorksheet(rows: readonly RejectedSheetRow[], options?: RejectedSheetOptions): Promise<string> {
  const originalFields = uniqueOriginalFields(rows);
  const headers = [
    'source row number',
    ...originalFields,
    'error field',
    'invalid value',
    'rejection reason',
    'failed rule/transform',
  ];
  const allRows: readonly (readonly CellValue[])[] = [headers];
  const lastCell = `${columnName(headers.length)}${rows.length + 1}`;
  const sheetData = options
    ? await rejectedRowsInBatches(rows, originalFields, options)
    : allRows.concat(rows.map((row) => [
      row.sourceRowNumber,
      ...originalFields.map((field) => row.originalRelevantFields[field] ?? null),
      row.errorField,
      row.invalidValue,
      row.rejectionReason,
      row.failedRuleOrTransform,
    ])).map((values, index) => worksheetRow(index + 1, values)).join('');

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<dimension ref="A1:${lastCell}"/>`
    + '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + `<sheetData>${sheetData}</sheetData>`
    + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
    + '</worksheet>';
}

async function rejectedRowsInBatches(
  rows: readonly RejectedSheetRow[],
  originalFields: readonly string[],
  options: RejectedSheetOptions,
): Promise<string> {
  const chunks: string[] = [];
  for (let start = 0; start < rows.length; start += options.batchSize) {
    const end = Math.min(rows.length, start + options.batchSize);
    for (let index = start; index < end; index += 1) {
      const row = rows[index];
      chunks.push(worksheetRow(index + 2, [
        row.sourceRowNumber,
        ...originalFields.map((field) => row.originalRelevantFields[field] ?? null),
        row.errorField,
        row.invalidValue,
        row.rejectionReason,
        row.failedRuleOrTransform,
      ]));
    }
    await options.onProgress({ completed: end, total: rows.length });
  }
  return worksheetRow(1, [
    'source row number',
    ...originalFields,
    'error field',
    'invalid value',
    'rejection reason',
    'failed rule/transform',
  ]) + chunks.join('');
}

function uniqueOriginalFields(rows: readonly RejectedSheetRow[]): string[] {
  const fields = new Set<string>();
  for (const row of rows) {
    for (const field of Object.keys(row.originalRelevantFields)) {
      fields.add(field);
    }
  }
  return [...fields];
}

function worksheetRow(rowNumber: number, values: readonly CellValue[]): string {
  const cells = values.map((value, index) => worksheetCell(
    `${columnName(index + 1)}${rowNumber}`,
    value,
  )).join('');
  return `<row r="${rowNumber}">${cells}</row>`;
}

function worksheetCell(reference: string, value: CellValue): string {
  if (value === null) {
    return `<c r="${reference}"/>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
}

function nextWorksheetNumber(pkg: OoxmlPackage, workbookDirectory: string): number {
  const prefix = `${workbookDirectory}/worksheets/sheet`;
  const numbers = pkg.listParts().flatMap((path) => {
    const match = path.match(new RegExp(`^${escapeRegExp(prefix)}(\\d+)\\.xml$`));
    return match ? [Number(match[1])] : [];
  });
  return Math.max(0, ...numbers) + 1;
}

function nextNumber(values: readonly string[]): number {
  const numbers = values.flatMap((value) => {
    const match = value.match(/(\d+)$/);
    return match ? [Number(match[1])] : [];
  });
  return Math.max(0, ...numbers) + 1;
}

function appendBeforeClosingTag(xml: string, tagName: string, content: string): string {
  const closingTag = `</${tagName}>`;
  const position = xml.lastIndexOf(closingTag);
  if (position < 0) {
    throw new Error(`Invalid OOXML: missing ${closingTag}`);
  }
  return `${xml.slice(0, position)}${content}${xml.slice(position)}`;
}

function relationshipPartPath(sourcePath: string): string {
  const directory = partDirectory(sourcePath);
  const basename = sourcePath.slice(sourcePath.lastIndexOf('/') + 1);
  return `${directory}/_rels/${basename}.rels`;
}

function partDirectory(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

function columnName(column: number): string {
  let value = column;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decode(content: Uint8Array): string {
  return new TextDecoder().decode(content);
}
