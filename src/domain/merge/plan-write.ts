import type { CellValue, DataRow } from '../dataset/types';
import type {
  DestinationRowAssignment,
  WriteClear,
  WriteDuplicate,
  WriteInsert,
  WriteKeep,
  WritePlan,
  WritePlanBatchOptions,
  WritePlanProgressPhase,
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

function rowsToWrite(input: WritePlanInput): DataRow[] {
  if (input.writeColumnIds === undefined) return [...input.incoming.rows];
  return input.incoming.rows.filter((row) => input.writeColumnIds?.some((columnId) => {
    const value = row.values[columnId] ?? null;
    return !isEmptyKeyValue(value);
  }));
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

function valuesMatch(
  incoming: DataRow,
  existing: DataRow,
  comparedColumnIds?: readonly string[],
): boolean {
  const columnIds = comparedColumnIds
    ?? [...new Set([...Object.keys(incoming.values), ...Object.keys(existing.values)])];
  return [...columnIds].every((columnId) => Object.is(
    incoming.values[columnId] ?? null,
    existing.values[columnId] ?? null,
  ));
}

function validateDestination(destination: WritePlanInput['destination']): void {
  for (const [name, value] of Object.entries(destination)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} deve ser um número de linha positivo.`);
    }
  }
  if (destination.dataStartRow <= destination.headerRow) {
    throw new RangeError('dataStartRow deve estar depois de headerRow.');
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
  const incomingRows = rowsToWrite(input);
  const clears: WriteClear[] = existingDataRows(input).map((row) => ({
    existingRowId: row.rowId,
    destinationRow: row.sourceRowNumber,
  }));
  const inserts = incomingRows.map((row, index) => insert(row, input.destination.dataStartRow + index));

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
  const incomingRows = rowsToWrite(input);
  const firstRow = nextDestinationRow(input);
  const inserts = incomingRows.map((row, index) => insert(row, firstRow + index));

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
  const incomingRows = rowsToWrite(input);
  const incomingGroups = groupRowsByKey(incomingRows, keyColumnIds);
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

  for (const incomingRow of incomingRows) {
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
    if (valuesMatch(incomingRow, existingRow, input.comparedColumnIds)) {
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
    throw new RangeError('O modo de atualização exige pelo menos uma coluna-chave.');
  }
  if (new Set(keyColumnIds).size !== keyColumnIds.length) {
    throw new RangeError('As colunas-chave de atualização devem ser únicas.');
  }
  return planUpdate(input, keyColumnIds);
}

export async function planWriteInBatches(
  input: WritePlanInput,
  options: WritePlanBatchOptions,
): Promise<WritePlan> {
  validateDestination(input.destination);
  assertBatchSize(options.batchSize);
  const keyColumnIds = input.keyColumnIds ?? [];
  if (input.mode === 'update') {
    if (keyColumnIds.length === 0) throw new RangeError('O modo de atualização exige pelo menos uma coluna-chave.');
    if (new Set(keyColumnIds).size !== keyColumnIds.length) {
      throw new RangeError('As colunas-chave de atualização devem ser únicas.');
    }
  }

  const incomingRows = rowsToWrite(input);
  const total = input.existing.rows.length + incomingRows.length;
  let completed = 0;
  let maxExistingRow = input.destination.dataStartRow - 1;
  const clears: WriteClear[] = [];
  const existingGroups = new Map<string, KeyGroup>();
  const incomingGroups = new Map<string, KeyGroup>();

  completed = await processWriteRows(input.existing.rows, completed, total, options, (row) => {
    if (row.sourceRowNumber < input.destination.dataStartRow) return;
    maxExistingRow = Math.max(maxExistingRow, row.sourceRowNumber);
    if (input.mode === 'replace') {
      clears.push({ existingRowId: row.rowId, destinationRow: row.sourceRowNumber });
    }
    if (input.mode === 'update') addToKeyGroup(existingGroups, row, keyColumnIds);
  });

  if (input.mode === 'replace' || input.mode === 'append') {
    const firstRow = input.mode === 'replace'
      ? input.destination.dataStartRow
      : maxExistingRow + 1;
    const inserts: WriteInsert[] = [];
    await processWriteRows(incomingRows, completed, total, options, (row, index) => {
      inserts.push(insert(row, firstRow + index));
    });
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

  await processWriteRows(incomingRows, completed, total, options, (row) => {
    addToKeyGroup(incomingGroups, row, keyColumnIds);
  });

  const duplicates = [
    ...await duplicateClassificationsInBatches(incomingGroups, 'incoming', keyColumnIds, options),
    ...await duplicateClassificationsInBatches(existingGroups, 'existing', keyColumnIds, options),
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
  let nextRow = Math.max(input.destination.dataStartRow - 1, maxExistingRow) + 1;

  await processWriteRows(
    incomingRows,
    0,
    incomingRows.length,
    options,
    (incomingRow) => {
      const values = keyValues(incomingRow, keyColumnIds);
      const key = serializeKey(values);
      if (values.some(isEmptyKeyValue)) {
        rejected.push({ incomingRowId: incomingRow.rowId, reason: 'missing-update-key', keyColumnIds: [...keyColumnIds], keyValues: values });
        return;
      }
      if (incomingDuplicateKeys.has(key)) {
        rejected.push({ incomingRowId: incomingRow.rowId, reason: 'incoming-duplicate-key', keyColumnIds: [...keyColumnIds], keyValues: values });
        return;
      }
      if (existingDuplicateKeys.has(key)) {
        rejected.push({ incomingRowId: incomingRow.rowId, reason: 'existing-duplicate-key', keyColumnIds: [...keyColumnIds], keyValues: values });
        return;
      }

      const existingRow = existingGroups.get(key)?.rows[0];
      if (!existingRow) {
        const planned = insert(incomingRow, nextRow++);
        inserts.push(planned);
        assignments.push(assignment('insert', planned.incomingRowId, planned.destinationRow));
        return;
      }
      if (valuesMatch(incomingRow, existingRow, input.comparedColumnIds)) {
        const planned: WriteKeep = { incomingRowId: incomingRow.rowId, existingRowId: existingRow.rowId, destinationRow: existingRow.sourceRowNumber };
        kept.push(planned);
        assignments.push(assignment('keep', planned.incomingRowId, planned.destinationRow, planned.existingRowId));
        return;
      }
      const planned: WriteUpdate = {
        incomingRowId: incomingRow.rowId,
        existingRowId: existingRow.rowId,
        destinationRow: existingRow.sourceRowNumber,
        values: { ...incomingRow.values },
      };
      updates.push(planned);
      assignments.push(assignment('update', planned.incomingRowId, planned.destinationRow, planned.existingRowId));
    },
    'plan-assign',
  );

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

async function processWriteRows(
  rows: readonly DataRow[],
  initialCompleted: number,
  total: number,
  options: WritePlanBatchOptions,
  processRow: (row: DataRow, index: number) => void,
  phase: WritePlanProgressPhase = 'plan',
): Promise<number> {
  let completed = initialCompleted;
  for (let start = 0; start < rows.length; start += options.batchSize) {
    const end = Math.min(rows.length, start + options.batchSize);
    for (let index = start; index < end; index += 1) processRow(rows[index], index);
    completed += end - start;
    await options.onProgress({ completed, total, phase });
  }
  return completed;
}

function addToKeyGroup(groups: Map<string, KeyGroup>, row: DataRow, keyColumnIds: readonly string[]): void {
  const values = keyValues(row, keyColumnIds);
  if (values.some(isEmptyKeyValue)) return;
  const key = serializeKey(values);
  const group = groups.get(key);
  if (group) group.rows.push(row);
  else groups.set(key, { values, rows: [row] });
}

async function duplicateClassificationsInBatches(
  groups: ReadonlyMap<string, KeyGroup>,
  scope: WriteDuplicate['scope'],
  keyColumnIds: readonly string[],
  options: WritePlanBatchOptions,
): Promise<WriteDuplicate[]> {
  const duplicates: WriteDuplicate[] = [];
  for (const group of groups.values()) {
    if (group.rows.length <= 1) continue;
    const rowIds: string[] = [];
    for (let start = 0; start < group.rows.length; start += options.batchSize) {
      const end = Math.min(group.rows.length, start + options.batchSize);
      for (let index = start; index < end; index += 1) rowIds.push(group.rows[index].rowId);
      await options.onProgress({ completed: end, total: group.rows.length, phase: 'plan' });
    }
    duplicates.push({ scope, keyColumnIds: [...keyColumnIds], keyValues: [...group.values], rowIds });
  }
  return duplicates;
}

function assertBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError('batchSize deve ser um número inteiro positivo.');
  }
}
