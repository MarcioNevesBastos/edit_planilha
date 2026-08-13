import { XMLParser } from 'fast-xml-parser';
import type { OoxmlPackage } from './ooxml-package';

export interface PackageRelationship {
  id: string;
  type: string;
  target: string;
  targetMode: string | null;
  targetPath: string | null;
}

export interface DefinedNameIndex {
  name: string;
  formula: string;
  localSheetId: number | null;
  hidden: boolean;
  sheetName: string | null;
  range: string | null;
}

export interface TableIndex {
  id: number;
  name: string;
  displayName: string;
  range: string;
  autoFilterRange: string | null;
  relationshipId: string;
  path: string;
}

export interface DetectedRegion {
  range: string;
  headerRow: number;
  dataRowCount: number;
}

export interface WorksheetIndex {
  name: string;
  order: number;
  sheetId: string;
  state: string;
  relationshipId: string;
  path: string;
  usedRange: string | null;
  autoFilterRange: string | null;
  protected: boolean;
  tables: TableIndex[];
  detectedRegions: DetectedRegion[];
}

export interface WorkbookIndex {
  workbookPath: string;
  workbookProtected: boolean;
  relationships: PackageRelationship[];
  sheets: WorksheetIndex[];
  definedNames: DefinedNameIndex[];
}

type XmlRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

export async function indexWorkbook(pkg: OoxmlPackage): Promise<WorkbookIndex> {
  const rootRelationships = parseRelationships(pkg, '_rels/.rels', '');
  const officeDocument = rootRelationships.find(
    (relationship) => relationship.type.endsWith('/officeDocument'),
  );

  if (!officeDocument?.targetPath) {
    throw new Error('O pacote OOXML não possui relacionamento com a pasta de trabalho.');
  }

  const workbookPath = officeDocument.targetPath;
  const workbook = record(parseXml(pkg, workbookPath).workbook, 'workbook');
  const relationships = parseRelationships(
    pkg,
    relationshipPartPath(workbookPath),
    workbookPath,
  );
  const sheetNodes = asArray(record(workbook.sheets, 'workbook.sheets').sheet);

  const sheetStubs = sheetNodes.map((value, order) => {
    const sheet = record(value, `workbook.sheets.sheet[${order}]`);
    const relationshipId = text(sheet.id, 'sheet relationship id');
    const relationship = relationships.find(({ id }) => id === relationshipId);

    if (!relationship?.targetPath) {
      throw new Error(`Relacionamento da planilha não encontrado: ${relationshipId}`);
    }

    return {
      name: text(sheet.name, 'sheet name'),
      order,
      sheetId: text(sheet.sheetId, 'sheet id'),
      state: optionalText(sheet.state) ?? 'visible',
      relationshipId,
      path: relationship.targetPath,
    };
  });

  const sheets = sheetStubs.map((sheet) => indexWorksheet(pkg, sheet));
  const definedNames = indexDefinedNames(workbook, sheetStubs.map(({ name }) => name));

  return {
    workbookPath,
    workbookProtected: Object.hasOwn(workbook, 'workbookProtection'),
    relationships,
    sheets,
    definedNames,
  };
}

function indexWorksheet(
  pkg: OoxmlPackage,
  sheet: Omit<WorksheetIndex, 'usedRange' | 'autoFilterRange' | 'protected' | 'tables' | 'detectedRegions'>,
): WorksheetIndex {
  const worksheet = record(parseXml(pkg, sheet.path).worksheet, `worksheet ${sheet.path}`);
  const worksheetRelationships = pkg.hasPart(relationshipPartPath(sheet.path))
    ? parseRelationships(pkg, relationshipPartPath(sheet.path), sheet.path)
    : [];
  const tablePartNodes = worksheet.tableParts
    ? asArray(record(worksheet.tableParts, 'tableParts').tablePart)
    : [];
  const tables = tablePartNodes.map((value) => {
    const tablePart = record(value, 'tablePart');
    const relationshipId = text(tablePart.id, 'table relationship id');
    const relationship = worksheetRelationships.find(({ id }) => id === relationshipId);

    if (!relationship?.targetPath) {
      throw new Error(`Relacionamento da tabela não encontrado: ${relationshipId}`);
    }

    const table = record(parseXml(pkg, relationship.targetPath).table, 'table');
    return {
      id: integer(table.id, 'table id'),
      name: text(table.name, 'table name'),
      displayName: text(table.displayName, 'table display name'),
      range: text(table.ref, 'table range'),
      autoFilterRange: table.autoFilter
        ? optionalText(record(table.autoFilter, 'table autoFilter').ref)
        : null,
      relationshipId,
      path: relationship.targetPath,
    };
  });

  return {
    ...sheet,
    usedRange: worksheet.dimension
      ? optionalText(record(worksheet.dimension, 'dimension').ref)
      : null,
    autoFilterRange: worksheet.autoFilter
      ? optionalText(record(worksheet.autoFilter, 'autoFilter').ref)
      : null,
    protected: Object.hasOwn(worksheet, 'sheetProtection'),
    tables,
    detectedRegions: detectRegions(worksheet),
  };
}

function indexDefinedNames(workbook: XmlRecord, sheetNames: string[]): DefinedNameIndex[] {
  if (!workbook.definedNames) {
    return [];
  }

  const container = record(workbook.definedNames, 'definedNames');
  return asArray(container.definedName).map((value) => {
    const definedName = record(value, 'definedName');
    const formula = text(definedName['#text'], 'defined name formula');
    const localSheetId = definedName.localSheetId === undefined
      ? null
      : integer(definedName.localSheetId, 'defined name localSheetId');
    const reference = parseRangeFormula(formula);

    return {
      name: text(definedName.name, 'defined name'),
      formula,
      localSheetId,
      hidden: booleanAttribute(definedName.hidden),
      sheetName: reference?.sheetName ?? (localSheetId === null ? null : sheetNames[localSheetId] ?? null),
      range: reference?.range ?? null,
    };
  });
}

function detectRegions(worksheet: XmlRecord): DetectedRegion[] {
  if (!worksheet.sheetData) {
    return [];
  }

  const sheetData = record(worksheet.sheetData, 'sheetData');
  const rows = asArray(sheetData.row).map((value, index) => {
    const row = record(value, 'row');
    const rowNumber = row.r === undefined ? index + 1 : integer(row.r, 'row number');
    const columns = asArray(row.c)
      .filter((cell) => isPopulatedCell(record(cell, 'cell')))
      .map((cell) => columnNumber(text(record(cell, 'cell').r, 'cell reference')));
    return { rowNumber, columns };
  });
  const header = rows.find(({ columns }) => columns.length >= 2);

  if (!header) {
    return [];
  }

  const firstColumn = Math.min(...header.columns);
  const lastColumn = Math.max(...header.columns);
  let lastRow = header.rowNumber;

  for (let rowNumber = header.rowNumber + 1; ; rowNumber += 1) {
    const row = rows.find((candidate) => candidate.rowNumber === rowNumber);
    if (!row || !row.columns.some((column) => column >= firstColumn && column <= lastColumn)) {
      break;
    }
    lastRow = rowNumber;
  }

  return [{
    range: `${columnLetters(firstColumn)}${header.rowNumber}:${columnLetters(lastColumn)}${lastRow}`,
    headerRow: header.rowNumber,
    dataRowCount: lastRow - header.rowNumber,
  }];
}

function isPopulatedCell(cell: XmlRecord): boolean {
  return ['v', 'f', 'is'].some((key) => Object.hasOwn(cell, key));
}

function parseRelationships(
  pkg: OoxmlPackage,
  relationshipsPath: string,
  sourcePartPath: string,
): PackageRelationship[] {
  const xml = record(parseXml(pkg, relationshipsPath).Relationships, 'Relationships');
  return asArray(xml.Relationship).map((value) => {
    const relationship = record(value, 'Relationship');
    const target = text(relationship.Target, 'relationship target');
    const targetMode = optionalText(relationship.TargetMode);

    return {
      id: text(relationship.Id, 'relationship id'),
      type: text(relationship.Type, 'relationship type'),
      target,
      targetMode,
      targetPath: targetMode === 'External' ? null : resolveTarget(sourcePartPath, target),
    };
  });
}

function parseXml(pkg: OoxmlPackage, path: string): XmlRecord {
  return record(parser.parse(new TextDecoder().decode(pkg.readPart(path))), path);
}

function relationshipPartPath(sourcePartPath: string): string {
  return normalizePartPath([
    partDirectory(sourcePartPath),
    '_rels',
    `${partBasename(sourcePartPath)}.rels`,
  ].filter(Boolean).join('/'));
}

function resolveTarget(sourcePartPath: string, target: string): string {
  if (target.startsWith('/')) {
    return target.slice(1);
  }
  const sourceDirectory = sourcePartPath ? partDirectory(sourcePartPath) : '';
  return normalizePartPath([sourceDirectory, target].filter(Boolean).join('/'));
}

function normalizePartPath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

function partDirectory(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? '' : path.slice(0, separator);
}

function partBasename(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? path : path.slice(separator + 1);
}

function parseRangeFormula(formula: string): { sheetName: string; range: string } | null {
  const match = formula.match(/^=?(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)$/i);
  if (!match) {
    return null;
  }
  return {
    sheetName: (match[1] ?? match[2]).replaceAll("''", "'"),
    range: match[3].replaceAll('$', '').toUpperCase(),
  };
}

function columnNumber(reference: string): number {
  const match = reference.match(/^([A-Z]+)\d+$/i);
  if (!match) {
    throw new Error(`Referência de célula inválida: ${reference}`);
  }
  return [...match[1].toUpperCase()].reduce(
    (column, letter) => column * 26 + letter.charCodeAt(0) - 64,
    0,
  );
}

function columnLetters(column: number): string {
  let value = column;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function record(value: unknown, label: string): XmlRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`OOXML inválido: ${label}`);
  }
  return value as XmlRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`OOXML inválido: ${label}`);
  }
  return String(value);
}

function optionalText(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

function integer(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`OOXML inválido: ${label}`);
  }
  return parsed;
}

function booleanAttribute(value: unknown): boolean {
  return value === '1' || String(value).toLowerCase() === 'true';
}
