import type { DatasetColumn } from '../../domain/dataset/types';
import { zipSync } from 'fflate';
import { openOoxmlPackage, type OoxmlPackage } from './ooxml-package';
import { indexWorkbook, type WorkbookIndex } from './workbook-index';

export type OutputBaseMode = 'source' | 'none';

export interface AutomaticDestination {
  sheetName: string;
  range: string;
  dataStartRow: number;
  templateRow: number;
}

export interface PrepareOutputBaseInput {
  mode: OutputBaseMode;
  sourceBuffer?: ArrayBuffer;
  columns: readonly DatasetColumn[];
}

export interface PreparedOutputBase {
  buffer: ArrayBuffer;
  destination: AutomaticDestination;
  index: WorkbookIndex;
}

const WORKBOOK_RELATIONSHIP_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const WORKSHEET_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

export async function prepareOutputBase(input: PrepareOutputBaseInput): Promise<PreparedOutputBase> {
  if (input.columns.length === 0) {
    throw new Error('A saída automática exige pelo menos uma coluna.');
  }

  const pkg = input.mode === 'source'
    ? await openSourcePackage(input.sourceBuffer)
    : await createEmptyPackage();
  return addOutputWorksheet(pkg, input.columns);
}

async function openSourcePackage(sourceBuffer: ArrayBuffer | undefined): Promise<OoxmlPackage> {
  if (!sourceBuffer) {
    throw new Error('A origem .xlsx é necessária para criar a base automática.');
  }
  return openOoxmlPackage(sourceBuffer);
}

async function createEmptyPackage(): Promise<OoxmlPackage> {
  const parts = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  };
  const zipped = zipSync(Object.fromEntries(Object.entries(parts).map(([path, content]) => [path, new TextEncoder().encode(content)])));
  return openOoxmlPackage(zipped.buffer);
}

async function addOutputWorksheet(
  pkg: OoxmlPackage,
  columns: readonly DatasetColumn[],
): Promise<PreparedOutputBase> {
  const workbookPath = findWorkbookPath(pkg);
  const workbook = decode(pkg.readPart(workbookPath));
  const relationshipsPath = relationshipPartPath(workbookPath);
  const relationships = decode(pkg.readPart(relationshipsPath));
  const contentTypes = decode(pkg.readPart('[Content_Types].xml'));
  const sheetNames = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((match) => decodeXml(match[1]));
  const sheetName = uniqueSheetName(sheetNames, 'Dados Preparados');
  const sheetIds = [...workbook.matchAll(/\bsheetId="(\d+)"/g)].map((match) => Number(match[1]));
  const relationshipIds = [...relationships.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1]));
  const sheetId = Math.max(0, ...sheetIds) + 1;
  const relationshipId = `rId${Math.max(0, ...relationshipIds) + 1}`;
  const sheetPath = nextWorksheetPath(pkg);
  const target = relativeTarget(workbookPath, sheetPath);
  const worksheet = worksheetXml(columns);

  pkg.addPart(sheetPath, worksheet);
  pkg.updatePart(workbookPath, insertBefore(workbook, '</sheets>',
    `<sheet name="${escapeXml(sheetName)}" sheetId="${sheetId}" state="visible" r:id="${relationshipId}"/>`));
  pkg.updatePart(relationshipsPath, insertBefore(relationships, '</Relationships>',
    `<Relationship Id="${relationshipId}" Type="${WORKBOOK_RELATIONSHIP_TYPE}" Target="${target}"/>`));
  pkg.updatePart('[Content_Types].xml', insertBefore(contentTypes, '</Types>',
    `<Override PartName="/${sheetPath}" ContentType="${WORKSHEET_CONTENT_TYPE}"/>`));

  const lastColumn = columnLetters(columns.length - 1);
  const buffer = await pkg.emit();
  return {
    buffer,
    index: await indexWorkbook(await openOoxmlPackage(buffer)),
    destination: {
      sheetName,
      range: `A1:${lastColumn}2`,
      dataStartRow: 2,
      templateRow: 2,
    },
  };
}

function findWorkbookPath(pkg: OoxmlPackage): string {
  const rootRelationships = decode(pkg.readPart('_rels/.rels'));
  const target = rootRelationships.match(/<Relationship\b[^>]*\bType="[^"]*\/officeDocument"[^>]*\bTarget="([^"]+)"/i)?.[1];
  if (!target) throw new Error('A pasta de trabalho não possui uma parte principal.');
  return target.replace(/^\//, '');
}

function relationshipPartPath(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  const directory = slash === -1 ? '' : `${partPath.slice(0, slash)}/`;
  const file = partPath.slice(slash + 1);
  return `${directory}_rels/${file}.rels`;
}

function nextWorksheetPath(pkg: OoxmlPackage): string {
  const numbers = pkg.listParts()
    .map((path) => path.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number);
  return `xl/worksheets/sheet${Math.max(0, ...numbers) + 1}.xml`;
}

function relativeTarget(workbookPath: string, sheetPath: string): string {
  const workbookDirectory = workbookPath.slice(0, workbookPath.lastIndexOf('/') + 1);
  return sheetPath.startsWith(workbookDirectory) ? sheetPath.slice(workbookDirectory.length) : `/${sheetPath}`;
}

function worksheetXml(columns: readonly DatasetColumn[]): string {
  const headerCells = columns.map((column, index) => (
    `<c r="${columnLetters(index)}1" t="inlineStr"><is><t>${escapeXml(column.header)}</t></is></c>`
  )).join('');
  const emptyCells = columns.map((_, index) => `<c r="${columnLetters(index)}2"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${columnLetters(columns.length - 1)}2"/><sheetData><row r="1">${headerCells}</row><row r="2">${emptyCells}</row></sheetData></worksheet>`;
}

function columnLetters(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function uniqueSheetName(existing: readonly string[], preferred: string): string {
  const occupied = new Set(existing.map((name) => name.toLocaleLowerCase()));
  if (!occupied.has(preferred.toLocaleLowerCase())) return preferred;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${preferred} ${suffix}`;
    if (!occupied.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

function insertBefore(xml: string, closingTag: string, value: string): string {
  const index = xml.lastIndexOf(closingTag);
  if (index < 0) throw new Error(`XML inválido: elemento ${closingTag} não encontrado.`);
  return `${xml.slice(0, index)}${value}${xml.slice(index)}`;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
