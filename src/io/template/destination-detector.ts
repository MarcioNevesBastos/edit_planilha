import type { WorkbookIndex } from './workbook-index';

export interface DefinedNameIdentity {
  name: string;
  localSheetId: number | null;
}

export type DestinationConfidence = 'high' | 'medium';

export type DestinationCandidate =
  | {
      kind: 'table';
      sheetName: string;
      range: string;
      confidence: DestinationConfidence;
      explanation: string;
      tableName: string;
    }
  | {
      kind: 'named-range';
      sheetName: string;
      range: string;
      confidence: DestinationConfidence;
      explanation: string;
      definedName: DefinedNameIdentity;
    }
  | {
      kind: 'detected-region';
      sheetName: string;
      range: string;
      confidence: DestinationConfidence;
      explanation: string;
    };

export interface ManualDestinationSelectionAction {
  kind: 'manual-selection';
  label: string;
}

export const manualDestinationSelectionAction: ManualDestinationSelectionAction = {
  kind: 'manual-selection',
  label: 'Select a range manually',
};

export function detectDestination(
  index: WorkbookIndex,
  sheetName: string,
): DestinationCandidate[] {
  const sheet = index.sheets.find((candidate) => candidate.name === sheetName);
  if (!sheet) {
    return [];
  }

  const tables: DestinationCandidate[] = sheet.tables.filter((table) => hasModelRow(table.range)).map((table) => ({
    kind: 'table',
    sheetName,
    range: table.range,
    confidence: 'high',
    explanation: `Excel table "${table.displayName}" defines a structured destination.`,
    tableName: table.displayName,
  }));
  const namedRanges: DestinationCandidate[] = index.definedNames
    .filter((definedName) => definedName.sheetName === sheetName
      && definedName.range
      && hasModelRow(definedName.range))
    .map((definedName) => ({
      kind: 'named-range',
      sheetName,
      range: definedName.range!,
      confidence: 'high',
      explanation: `Defined name "${definedName.name}" identifies this destination range.`,
      definedName: { name: definedName.name, localSheetId: definedName.localSheetId },
    }));
  const detectedRegions: DestinationCandidate[] = sheet.detectedRegions.filter((region) => region.dataRowCount > 0).map((region) => ({
    kind: 'detected-region',
    sheetName,
    range: region.range,
    confidence: 'medium',
    explanation: 'A contiguous header and data region was detected automatically.',
  }));

  return [...tables, ...namedRanges, ...detectedRegions];
}

export function destinationDetectionWarnings(
  index: WorkbookIndex,
  sheetName: string,
): string[] {
  const sheet = index.sheets.find((candidate) => candidate.name === sheetName);
  if (!sheet) return [];
  const warning = (label: string) => `${label}: o destino contém somente cabeçalhos e precisa de ao menos uma linha modelo.`;
  return [
    ...sheet.tables.filter((table) => !hasModelRow(table.range)).map((table) => warning(table.displayName)),
    ...index.definedNames.filter((definedName) => definedName.sheetName === sheetName
      && definedName.range
      && !hasModelRow(definedName.range)).map((definedName) => warning(definedName.name)),
    ...sheet.detectedRegions.filter((region) => region.dataRowCount === 0).map((region) => warning(region.range)),
  ];
}

function hasModelRow(range: string): boolean {
  const match = range.replaceAll('$', '').match(/^[A-Z]+(\d+)(?::[A-Z]+(\d+))?$/i);
  return Boolean(match && Number(match[2] ?? match[1]) > Number(match[1]));
}
