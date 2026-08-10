import { insertRowsInFormulaA1, shiftFormulaA1 } from './formula-shift';
import type { OoxmlPackage } from './ooxml-package';

export interface DestinationExpansionPlan {
  worksheetPath: string;
  destinationRange: string;
  dataStartRow: number;
  templateRow: number;
  requiredDataRows: number;
  tablePath?: string;
}

export interface DestinationExpansionProgress {
  completed: number;
  total: number;
}

export interface DestinationExpansionOptions {
  batchSize: number;
  onProgress(progress: DestinationExpansionProgress): Promise<void> | void;
}

interface CellRange {
  startColumn: string;
  startRow: number;
  endColumn: string;
  endRow: number;
}

export async function expandDestination(
  pkg: OoxmlPackage,
  plan: DestinationExpansionPlan,
  options?: DestinationExpansionOptions,
): Promise<void> {
  const destination = parseRange(plan.destinationRange);
  validatePlan(plan, destination);

  const currentDataRows = destination.endRow - plan.dataStartRow + 1;
  const additionalRows = Math.max(0, plan.requiredDataRows - currentDataRows);
  if (additionalRows === 0) {
    return;
  }

  const targetLastRow = destination.endRow + additionalRows;
  const worksheet = decode(pkg.readPart(plan.worksheetPath));
  assertSupportedRowGeometry(worksheet, plan.worksheetPath);
  if (options && (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1)) {
    throw new RangeError('batchSize must be a positive whole number');
  }
  const expandedWorksheet = await expandWorksheet(
    worksheet,
    destination,
    plan.templateRow,
    additionalRows,
    targetLastRow,
    options,
  );
  const expandedTable = plan.tablePath
    ? expandTable(
        decode(pkg.readPart(plan.tablePath)),
        destination,
        targetLastRow,
        plan.destinationRange,
      )
    : null;
  const expandedDrawings = expandDrawingAnchors(
    pkg,
    plan.worksheetPath,
    worksheet,
    destination.endRow,
    additionalRows,
  );

  pkg.updatePart(plan.worksheetPath, expandedWorksheet);
  if (plan.tablePath && expandedTable) {
    pkg.updatePart(plan.tablePath, expandedTable);
  }
  for (const [path, drawing] of expandedDrawings) {
    pkg.updatePart(path, drawing);
  }
}

function validatePlan(plan: DestinationExpansionPlan, destination: CellRange): void {
  for (const [label, value] of [
    ['dataStartRow', plan.dataStartRow],
    ['templateRow', plan.templateRow],
    ['requiredDataRows', plan.requiredDataRows],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${label} must be a positive integer`);
    }
  }
  if (plan.dataStartRow < destination.startRow || plan.dataStartRow > destination.endRow) {
    throw new Error(
      `Data start row ${plan.dataStartRow} is outside destination ${plan.destinationRange}`,
    );
  }
  if (plan.templateRow < plan.dataStartRow || plan.templateRow > destination.endRow) {
    throw new Error(
      `Template row ${plan.templateRow} is outside destination data rows ${plan.dataStartRow}:${destination.endRow}`,
    );
  }
}

async function expandWorksheet(
  worksheet: string,
  destination: CellRange,
  templateRowNumber: number,
  additionalRows: number,
  targetLastRow: number,
  options?: DestinationExpansionOptions,
): Promise<string> {
  const sheetDataMatch = worksheet.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
  if (!sheetDataMatch) {
    throw new Error('Worksheet has no sheetData element');
  }

  const rowPattern = /<row\b[^>]*\br="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g;
  const rows = [...sheetDataMatch[1].matchAll(rowPattern)];
  const template = rows.find((match) => Number(match[1]) === templateRowNumber)?.[0];
  if (!template) {
    throw new Error(`Template row ${templateRowNumber} was not found in worksheet`);
  }

  const clones = options
    ? await buildRowClones(template, destination, templateRowNumber, additionalRows, options)
    : Array.from({ length: additionalRows }, (_, index) => {
      const rowNumber = destination.endRow + index + 1;
      return shiftRow(template, rowNumber - templateRowNumber, true);
    }).join('');

  let inserted = false;
  const expandedSheetData = sheetDataMatch[1].replace(rowPattern, (row, rowText: string) => {
    const rowNumber = Number(rowText);
    if (rowNumber <= destination.endRow) {
      return row;
    }
    const prefix = inserted ? '' : clones;
    inserted = true;
    return prefix + moveRowAtInsertion(row, additionalRows, destination.endRow);
  }) + (inserted ? '' : clones);

  let result = worksheet.replace(
    sheetDataMatch[1],
    expandedSheetData,
  );
  result = updateDimension(result, destination.endRow, targetLastRow, additionalRows);
  result = updateReferenceAttributes(
    result,
    'autoFilter',
    (range) => expandStructuralRange(range, destination, targetLastRow, additionalRows),
  );
  result = updateValidationRanges(
    result,
    destination,
    targetLastRow,
    additionalRows,
  );
  result = updateReferenceAttributes(
    result,
    'mergeCell',
    (range) => updateRangeAtInsertion(range, destination, targetLastRow, additionalRows),
  );
  result = updateReferenceAttributes(
    result,
    'hyperlink',
    (range) => updateHyperlinkRangeAtInsertion(range, destination.endRow, additionalRows),
  );
  result = updateSqrefAttributes(
    result,
    ['conditionalFormatting', 'ignoredError', 'protectedRange'],
    destination,
    targetLastRow,
    additionalRows,
  );
  result = updateTopLeftCells(result, destination.endRow, additionalRows);
  return result;
}

function updateHyperlinkRangeAtInsertion(
  range: CellRange,
  insertionRow: number,
  additionalRows: number,
): CellRange {
  if (range.startRow === range.endRow) {
    return range.startRow > insertionRow
      ? { ...range, startRow: range.startRow + additionalRows, endRow: range.endRow + additionalRows }
      : range;
  }
  return expandRowsAtInsertion(
    range,
    insertionRow,
    insertionRow + additionalRows,
    additionalRows,
  );
}

async function buildRowClones(
  template: string,
  destination: CellRange,
  templateRowNumber: number,
  additionalRows: number,
  options: DestinationExpansionOptions,
): Promise<string> {
  const clones: string[] = [];
  for (let start = 0; start < additionalRows; start += options.batchSize) {
    const end = Math.min(additionalRows, start + options.batchSize);
    for (let index = start; index < end; index += 1) {
      const rowNumber = destination.endRow + index + 1;
      clones.push(shiftRow(template, rowNumber - templateRowNumber, true));
    }
    await options.onProgress({ completed: end, total: additionalRows });
  }
  return clones.join('');
}

function expandTable(
  table: string,
  destination: CellRange,
  targetLastRow: number,
  expectedRange: string,
): string {
  const tableTag = table.match(/<table\b[^>]*>/)?.[0];
  const actualRange = tableTag ? attribute(tableTag, 'ref') : null;
  if (!actualRange || normalizeRange(actualRange) !== normalizeRange(expectedRange)) {
    throw new Error(
      `Table range ${actualRange ?? '(missing)'} does not match destination ${expectedRange}`,
    );
  }

  const expandedRange = formatRange({ ...destination, endRow: targetLastRow });
  let updatedRoot = false;
  let result = table.replace(/<table\b[^>]*>/, (tag) => {
    updatedRoot = true;
    return setAttribute(tag, 'ref', expandedRange);
  });
  if (!updatedRoot) {
    throw new Error('Invalid table XML');
  }
  result = updateReferenceAttributes(result, 'autoFilter', () => expandedRange);
  return result;
}

function shiftRow(row: string, rowDelta: number, shiftFormulas: boolean): string {
  let shifted = row.replace(/(<row\b[^>]*\br=")(\d+)(")/, (_, start, rowText, end) => (
    `${start}${Number(rowText) + rowDelta}${end}`
  ));
  shifted = shifted.replace(/(<c\b[^>]*\br=")([A-Z]+)(\d+)(")/gi, (
    _,
    start,
    column,
    rowText,
    end,
  ) => `${start}${column}${Number(rowText) + rowDelta}${end}`);
  if (shiftFormulas) {
    shifted = shifted.replace(/(<f\b[^>]*>)([\s\S]*?)(<\/f>)/g, (_, open, formula, close) => (
      `${open}${shiftFormulaA1(formula, rowDelta, 0)}${close}`
    ));
  }
  return shifted;
}

function moveRowAtInsertion(row: string, rowDelta: number, insertionRow: number): string {
  let shifted = shiftRow(row, rowDelta, false);
  shifted = shifted.replace(/(<f\b[^>]*>)([\s\S]*?)(<\/f>)/g, (_, open, formula, close) => (
    `${open}${insertRowsInFormulaA1(formula, insertionRow, rowDelta)}${close}`
  ));
  return shifted;
}

function updateDimension(
  worksheet: string,
  insertionRow: number,
  targetLastRow: number,
  additionalRows: number,
): string {
  return updateReferenceAttributes(worksheet, 'dimension', (range) => {
    const endRow = range.endRow > insertionRow
      ? range.endRow + additionalRows
      : Math.max(range.endRow, targetLastRow);
    return formatRange({ ...range, endRow });
  });
}

function updateValidationRanges(
  worksheet: string,
  destination: CellRange,
  targetLastRow: number,
  additionalRows: number,
): string {
  return worksheet.replace(/(<dataValidation\b[^>]*\bsqref=")([^"]+)(")/g, (
    _,
    start,
    sqref,
    end,
  ) => {
    const ranges = String(sqref).trim().split(/\s+/).map((value) => {
      const range = parseRange(value);
      return formatRange(updateRangeAtInsertion(
        range,
        destination,
        targetLastRow,
        additionalRows,
      ));
    });
    return `${start}${ranges.join(' ')}${end}`;
  });
}

function updateSqrefAttributes(
  worksheet: string,
  tagNames: readonly string[],
  destination: CellRange,
  targetLastRow: number,
  additionalRows: number,
): string {
  const names = tagNames.join('|');
  const pattern = new RegExp(`(<(?:${names})\\b[^>]*\\bsqref=")([^"]+)(")`, 'g');
  return worksheet.replace(pattern, (_, start, sqref, end) => {
    const updated = String(sqref).trim().split(/\s+/).map((value) => formatRange(
      updateRangeAtInsertion(parseRange(value), destination, targetLastRow, additionalRows),
    ));
    return `${start}${updated.join(' ')}${end}`;
  });
}

function updateTopLeftCells(
  worksheet: string,
  insertionRow: number,
  additionalRows: number,
): string {
  return worksheet.replace(/(\btopLeftCell=")([A-Z]+)(\d+)(")/gi, (
    _, start, column, rowText, end,
  ) => {
    const row = Number(rowText);
    return `${start}${column}${row > insertionRow ? row + additionalRows : row}${end}`;
  });
}

function expandStructuralRange(
  range: CellRange,
  destination: CellRange,
  targetLastRow: number,
  additionalRows: number,
): CellRange {
  return updateRangeAtInsertion(
    range,
    destination,
    targetLastRow,
    additionalRows,
  );
}

function updateRangeAtInsertion(
  range: CellRange,
  destination: CellRange,
  targetLastRow: number,
  additionalRows: number,
): CellRange {
  return expandRowsAtInsertion(
    range,
    destination.endRow,
    targetLastRow,
    additionalRows,
  );
}

function expandRowsAtInsertion(
  range: CellRange,
  insertionRow: number,
  targetLastRow: number,
  additionalRows: number,
): CellRange {
  if (range.startRow > insertionRow) {
    return {
      ...range,
      startRow: range.startRow + additionalRows,
      endRow: range.endRow + additionalRows,
    };
  }
  if (range.endRow >= insertionRow) {
    return {
      ...range,
      endRow: range.endRow === insertionRow
        ? targetLastRow
        : range.endRow + additionalRows,
    };
  }
  return range;
}

function updateReferenceAttributes(
  xml: string,
  tagName: string,
  update: (range: CellRange) => CellRange | string,
): string {
  const pattern = new RegExp(`(<${tagName}\\b[^>]*\\bref=")([^"]+)(")`, 'g');
  return xml.replace(pattern, (_, start, value, end) => {
    const updated = update(parseRange(value));
    return `${start}${typeof updated === 'string' ? updated : formatRange(updated)}${end}`;
  });
}

function parseRange(value: string): CellRange {
  const match = value.match(/^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i);
  if (!match) {
    throw new Error(`Invalid A1 range: ${value}`);
  }
  return {
    startColumn: match[1].toUpperCase(),
    startRow: Number(match[2]),
    endColumn: (match[3] ?? match[1]).toUpperCase(),
    endRow: Number(match[4] ?? match[2]),
  };
}

function formatRange(range: CellRange): string {
  const start = `${range.startColumn}${range.startRow}`;
  const end = `${range.endColumn}${range.endRow}`;
  return start === end ? start : `${start}:${end}`;
}

function normalizeRange(value: string): string {
  return formatRange(parseRange(value));
}

function columnNumber(letters: string): number {
  return [...letters].reduce(
    (column, letter) => column * 26 + letter.charCodeAt(0) - 64,
    0,
  );
}

function attribute(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
}

function setAttribute(tag: string, name: string, value: string): string {
  return tag.replace(new RegExp(`(\\b${name}=")[^"]*(")`), `$1${value}$2`);
}

function assertSupportedRowGeometry(worksheet: string, worksheetPath: string): void {
  if (/<(?:extLst|legacyDrawing|legacyDrawingHF|oleObjects|controls|picture)\b/i.test(worksheet)) {
    throw new Error(`Unsupported row-bearing worksheet geometry in ${worksheetPath}`);
  }
}

function expandDrawingAnchors(
  pkg: OoxmlPackage,
  worksheetPath: string,
  worksheet: string,
  insertionRow: number,
  additionalRows: number,
): Map<string, string> {
  const relationshipIds = [...worksheet.matchAll(/<drawing\b[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/g)]
    .map((match) => match[1]);
  if (relationshipIds.length === 0) return new Map();

  const relationshipsPath = relationshipPartPath(worksheetPath);
  if (!pkg.hasPart(relationshipsPath)) {
    throw new Error(`Drawing relationships were not found for ${worksheetPath}`);
  }
  const relationships = decode(pkg.readPart(relationshipsPath));
  const updates = new Map<string, string>();
  for (const relationshipId of relationshipIds) {
    const relationship = [...relationships.matchAll(/<Relationship\b[^>]*\/>/g)]
      .map((match) => match[0])
      .find((tag) => attribute(tag, 'Id') === relationshipId);
    if (!relationship || !attribute(relationship, 'Type')?.endsWith('/drawing')) {
      throw new Error(`Drawing relationship was not found: ${relationshipId}`);
    }
    const target = attribute(relationship, 'Target');
    if (!target) throw new Error(`Drawing target was not found: ${relationshipId}`);
    const drawingPath = resolveTarget(worksheetPath, target);
    const drawing = decode(pkg.readPart(drawingPath));
    if (/<xdr:extLst\b/i.test(drawing)) {
      throw new Error(`Unsupported row-bearing drawing geometry in ${drawingPath}`);
    }
    updates.set(drawingPath, drawing.replace(
      /(<xdr:row>)(\d+)(<\/xdr:row>)/g,
      (_, open, rowText, close) => {
        const row = Number(rowText);
        return `${open}${row >= insertionRow ? row + additionalRows : row}${close}`;
      },
    ));
  }
  return updates;
}

function relationshipPartPath(sourcePath: string): string {
  const separator = sourcePath.lastIndexOf('/');
  const directory = separator < 0 ? '' : sourcePath.slice(0, separator);
  const basename = sourcePath.slice(separator + 1);
  return `${directory}/_rels/${basename}.rels`.replace(/^\//, '');
}

function resolveTarget(sourcePath: string, target: string): string {
  const sourceDirectory = sourcePath.slice(0, Math.max(0, sourcePath.lastIndexOf('/')));
  const segments = `${sourceDirectory}/${target}`.split('/');
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') normalized.pop();
    else normalized.push(segment);
  }
  return normalized.join('/');
}

function decode(content: Uint8Array): string {
  return new TextDecoder().decode(content);
}
