import type { CellValue, DataRow } from '../dataset/types';
import type {
  DestinationRowAssignment,
  WriteClear,
  WriteDuplicate,
  WriteInsert,
  WriteKeep,
  WritePlan,
  WritePlanInput,
  WriteRejection,
  WriteUpdate,
} from './types';

interface KeyGroup {
  values: CellValue[];
  rows: DataRow[];
}

function isEmptyKeyValue(value: CellValue): boolean {
  return value === null || (typeof value === 'string' && value.trim() === '');
}

function keyValues(row: DataRow, keyColumnIds: readonly string[]): CellValue[] {
  return keyColumnIds.map((columnId) => row.values[columnId] ?? null);
}

function serializeKey(values: readonly CellValue[]): string {
  return JSON.stringify(values.map((value) => [typeof value, value]));
}

function groupRowsByKey(rows: readonly DataRow[], keyColumnIds: readonly string[]): Map<string, KeyGroup> {
  const groups = new Map<string, KeyGroup>();
  for (const row of rows) {
    const values = keyValues(row, keyColumnIds);
    if (values.some(isEmptyKeyValue)) continue;
    const key = serializeKey(values);
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
    } else {
      groups.set(key, { values, rows: [row] });
    }
  }
  return groups;
}

function duplicateClassifications(
  groups: ReadonlyMap<string, KeyGroup>,
  scope: WriteDuplicate['scope'],
  keyColumnIds: readonly string[],
): WriteDuplicate[] {
  return [...groups.values()]
    .filter((group) => group.rows.length > 1)
    .map((group) => ({
      scope,
      keyColumnIds: [...keyColumnIds],
      keyValues: [...group.values],
      rowIds: group.rows.map((row) => row.rowId),
    }));
}

function valuesMatch(incoming: DataRow, existing: DataRow): boolean {
  const columnIds = new Set([...Object.keys(incoming.values), ...Object.keys(existing.values)]);
  return [...columnIds].every((columnId) => Object.is(
    incoming.values[columnId] ?? null,
    existing.values[columnId] ?? null,
  ));
}

function validateDestination(destination: WritePlanInput['destination']): void {
  for (const [name, value] of Object.entries(destination)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive row number`);
    }
  }
  if (destination.dataStartRow <= destination.headerRow) {
    throw new RangeError('dataStartRow must be after headerRow');
  }
}

function existingDataRows(input: WritePlanInput): DataRow[] {
  return input.existing.rows.filter((row) => row.sourceRowNumber >= input.destination.dataStartRow);
}

function nextDestinationRow(input: WritePlanInput): number {
  return Math.max(
    input.destination.dataStartRow - 1,
    ...existingDataRows(input).map((row) => row.sourceRowNumber),
  ) + 1;
}

function insert(row: DataRow, destinationRow: number): WriteInsert {
  return {
    incomingRowId: row.rowId,
    destinationRow,
    values: { ...row.values },
  };
}

function assignment(kind: DestinationRowAssignment['kind'], incomingRowId: string, destinationRow: number, existingRowId?: string): DestinationRowAssignment {
  return { kind, incomingRowId, destinationRow, ...(existingRowId === undefined ? {} : { existingRowId }) };
}

function planReplace(input: WritePlanInput): WritePlan {
  const clears: WriteClear[] = existingDataRows(input).map((row) => ({
    existingRowId: row.rowId,
    destinationRow: row.sourceRowNumber,
  }));
  const inserts = input.incoming.rows.map((row, index) => insert(row, input.destination.dataStartRow + index));

  return {
    mode: input.mode,
    headerRow: input.destination.headerRow,
    clears,
    inserts,
    updates: [],
    kept: [],
    duplicates: [],
    rejected: [],
    assignments: inserts.map(({ incomingRowId, destinationRow }) => assignment('insert', incomingRowId, destinationRow)),
  };
}

function planAppend(input: WritePlanInput): WritePlan {
  const firstRow = nextDestinationRow(input);
  const inserts = input.incoming.rows.map((row, index) => insert(row, firstRow + index));

  return {
    mode: input.mode,
    headerRow: input.destination.headerRow,
    clears: [],
    inserts,
    updates: [],
    kept: [],
    duplicates: [],
    rejected: [],
    assignments: inserts.map(({ incomingRowId, destinationRow }) => assignment('insert', incomingRowId, destinationRow)),
  };
}

function planUpdate(input: WritePlanInput, keyColumnIds: readonly string[]): WritePlan {
  const incomingGroups = groupRowsByKey(input.incoming.rows, keyColumnIds);
  const existingGroups = groupRowsByKey(existingDataRows(input), keyColumnIds);
  const duplicates = [
    ...duplicateClassifications(incomingGroups, 'incoming', keyColumnIds),
    ...duplicateClassifications(existingGroups, 'existing', keyColumnIds),
  ];
  const incomingDuplicateKeys = new Set(
    [...incomingGroups].filter(([, group]) => group.rows.length > 1).map(([key]) => key),
  );
  const existingDuplicateKeys = new Set(
    [...existingGroups].filter(([, group]) => group.rows.length > 1).map(([key]) => key),
  );
  const inserts: WriteInsert[] = [];
  const updates: WriteUpdate[] = [];
  const kept: WriteKeep[] = [];
  const rejected: WriteRejection[] = [];
  const assignments: DestinationRowAssignment[] = [];
  let nextRow = nextDestinationRow(input);

  for (const incomingRow of input.incoming.rows) {
    const values = keyValues(incomingRow, keyColumnIds);
    const key = serializeKey(values);
    if (values.some(isEmptyKeyValue)) {
      rejected.push({
        incomingRowId: incomingRow.rowId,
        reason: 'missing-update-key',
        keyColumnIds: [...keyColumnIds],
        keyValues: values,
      });
      continue;
    }
    if (incomingDuplicateKeys.has(key)) {
      rejected.push({
        incomingRowId: incomingRow.rowId,
        reason: 'incoming-duplicate-key',
        keyColumnIds: [...keyColumnIds],
        keyValues: values,
      });
      continue;
    }
    if (existingDuplicateKeys.has(key)) {
      rejected.push({
        incomingRowId: incomingRow.rowId,
        reason: 'existing-duplicate-key',
        keyColumnIds: [...keyColumnIds],
        keyValues: values,
      });
      continue;
    }

    const existingRow = existingGroups.get(key)?.rows[0];
    if (!existingRow) {
      const planned = insert(incomingRow, nextRow++);
      inserts.push(planned);
      assignments.push(assignment('insert', planned.incomingRowId, planned.destinationRow));
      continue;
    }
    if (valuesMatch(incomingRow, existingRow)) {
      const planned: WriteKeep = {
        incomingRowId: incomingRow.rowId,
        existingRowId: existingRow.rowId,
        destinationRow: existingRow.sourceRowNumber,
      };
      kept.push(planned);
      assignments.push(assignment('keep', planned.incomingRowId, planned.destinationRow, planned.existingRowId));
      continue;
    }
    const planned: WriteUpdate = {
      incomingRowId: incomingRow.rowId,
      existingRowId: existingRow.rowId,
      destinationRow: existingRow.sourceRowNumber,
      values: { ...incomingRow.values },
    };
    updates.push(planned);
    assignments.push(assignment('update', planned.incomingRowId, planned.destinationRow, planned.existingRowId));
  }

  return {
    mode: input.mode,
    headerRow: input.destination.headerRow,
    clears: [],
    inserts,
    updates,
    kept,
    duplicates,
    rejected,
    assignments,
  };
}

export function planWrite(input: WritePlanInput): WritePlan {
  validateDestination(input.destination);
  if (input.mode === 'replace') return planReplace(input);
  if (input.mode === 'append') return planAppend(input);

  const keyColumnIds = input.keyColumnIds ?? [];
  if (keyColumnIds.length === 0) {
    throw new RangeError('Update mode requires at least one key column');
  }
  if (new Set(keyColumnIds).size !== keyColumnIds.length) {
    throw new RangeError('Update key columns must be unique');
  }
  return planUpdate(input, keyColumnIds);
}
