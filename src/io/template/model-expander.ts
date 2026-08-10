import { shiftFormulaA1 } from './formula-shift';
import type { OoxmlPackage } from './ooxml-package';

export interface DestinationExpansionPlan {
  worksheetPath: string;
  destinationRange: string;
  dataStartRow: number;
  templateRow: number;
  requiredDataRows: number;
  tablePath?: string;
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
  const expandedWorksheet = expandWorksheet(
    worksheet,
    destination,
    plan.templateRow,
    additionalRows,
    targetLastRow,
  );
  const expandedTable = plan.tablePath
    ? expandTable(
        decode(pkg.readPart(plan.tablePath)),
        destination,
        targetLastRow,
        plan.destinationRange,
      )
    : null;

  pkg.updatePart(plan.worksheetPath, expandedWorksheet);
  if (plan.tablePath && expandedTable) {
    pkg.updatePart(plan.tablePath, expandedTable);
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

function expandWorksheet(
  worksheet: string,
  destination: CellRange,
  templateRowNumber: number,
  additionalRows: number,
  targetLastRow: number,
): string {
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

  const clones = Array.from({ length: additionalRows }, (_, index) => {
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
    return prefix + shiftRow(row, additionalRows, true);
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
  return result;
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
  if (rangesOverlapColumns(range, destination)) {
    return expandRowsAtInsertion(
      range,
      destination.endRow,
      targetLastRow,
      additionalRows,
    );
  }
  if (range.startRow > destination.endRow) {
    return {
      ...range,
      startRow: range.startRow + additionalRows,
      endRow: range.endRow + additionalRows,
    };
  }
  return range;
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

function rangesOverlapColumns(left: CellRange, right: CellRange): boolean {
  return columnNumber(left.startColumn) <= columnNumber(right.endColumn)
    && columnNumber(right.startColumn) <= columnNumber(left.endColumn);
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

function decode(content: Uint8Array): string {
  return new TextDecoder().decode(content);
}
