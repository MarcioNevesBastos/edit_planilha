import type { CellValue, DataRow, Dataset } from '../dataset/types';

export type WriteMode = 'replace' | 'append' | 'update';

export interface WriteDestination {
  headerRow: number;
  dataStartRow: number;
}

export interface WritePlanInput {
  mode: WriteMode;
  incoming: Dataset;
  existing: Dataset;
  destination: WriteDestination;
  keyColumnIds?: readonly string[];
  comparedColumnIds?: readonly string[];
  writeColumnIds?: readonly string[];
}

export interface WriteClear {
  existingRowId: string;
  destinationRow: number;
}

export interface WriteInsert {
  incomingRowId: string;
  destinationRow: number;
  values: Record<string, CellValue>;
}

export interface WriteUpdate {
  incomingRowId: string;
  existingRowId: string;
  destinationRow: number;
  values: Record<string, CellValue>;
}

export interface WriteKeep {
  incomingRowId: string;
  existingRowId: string;
  destinationRow: number;
}

export interface WriteDuplicate {
  scope: 'incoming' | 'existing';
  keyColumnIds: string[];
  keyValues: CellValue[];
  rowIds: string[];
}

export type WriteRejectionReason =
  | 'incoming-duplicate-key'
  | 'existing-duplicate-key'
  | 'missing-update-key';

export interface WriteRejection {
  incomingRowId: string;
  reason: WriteRejectionReason;
  keyColumnIds: string[];
  keyValues: CellValue[];
}

export interface DestinationRowAssignment {
  kind: 'insert' | 'update' | 'keep';
  incomingRowId: string;
  existingRowId?: string;
  destinationRow: number;
}

export interface WritePlan {
  mode: WriteMode;
  headerRow: number;
  clears: WriteClear[];
  inserts: WriteInsert[];
  updates: WriteUpdate[];
  kept: WriteKeep[];
  duplicates: WriteDuplicate[];
  rejected: WriteRejection[];
  assignments: DestinationRowAssignment[];
}

export type WritePlanProgressPhase = 'plan' | 'plan-assign';

export interface WritePlanBatchProgress {
  completed: number;
  total: number;
  phase: WritePlanProgressPhase;
}

export interface WritePlanBatchOptions {
  batchSize: number;
  onProgress(progress: WritePlanBatchProgress): Promise<void> | void;
}

export type { CellValue, DataRow, Dataset };
