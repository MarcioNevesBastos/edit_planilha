import type { WorkbookIndex } from './workbook-index';

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
      definedName: string;
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

  const tables: DestinationCandidate[] = sheet.tables.map((table) => ({
    kind: 'table',
    sheetName,
    range: table.range,
    confidence: 'high',
    explanation: `Excel table "${table.displayName}" defines a structured destination.`,
    tableName: table.displayName,
  }));
  const namedRanges: DestinationCandidate[] = index.definedNames
    .filter((definedName) => definedName.sheetName === sheetName && definedName.range)
    .map((definedName) => ({
      kind: 'named-range',
      sheetName,
      range: definedName.range!,
      confidence: 'high',
      explanation: `Defined name "${definedName.name}" identifies this destination range.`,
      definedName: definedName.name,
    }));
  const detectedRegions: DestinationCandidate[] = sheet.detectedRegions.map((region) => ({
    kind: 'detected-region',
    sheetName,
    range: region.range,
    confidence: 'medium',
    explanation: 'A contiguous header and data region was detected automatically.',
  }));

  return [...tables, ...namedRanges, ...detectedRegions];
}
