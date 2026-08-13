import { CancellationRegistry } from '../utils/cancellation';
import type { CellValue, DataRow, Dataset } from '../domain/dataset/types';
import { planWriteInBatches } from '../domain/merge/plan-write';
import { applyTransform, compareDataRows } from '../domain/transforms/apply-transform';
import type { TransformCommand } from '../domain/transforms/types';
import { matchesConditionalMatrixEntry, validateRow } from '../domain/validation/validate-row';
import type { ConditionalMatrixRule, ValidationIssue, ValidationRule } from '../domain/validation/types';
import { listSourceSheets, readSource } from '../io/source/read-source';
import { exportWorkbook, scanExportRisks } from '../io/template/export-workbook';
import { extractDestinationDataset } from '../io/template/extract-destination';
import { openOoxmlPackage } from '../io/template/ooxml-package';
import { indexWorkbook } from '../io/template/workbook-index';
import {
  DEFAULT_WORKER_BATCH_SIZE,
  isWorkerControlMessage,
  postWorkerResponse,
  type WorkerInboundMessage,
  type WorkerMessageTarget,
  type WorkerPhase,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerResult,
} from './protocol';

export interface DataWorkerDispatcher {
  dispatch(request: WorkerRequest): Promise<void>;
  cancel(operationId: string): void;
}

interface WorkerScope extends WorkerMessageTarget {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerInboundMessage>) => void): void;
}

class OperationCancelled extends Error {
  public constructor() {
    super('Operação cancelada.');
  }
}

const ROW_BATCHED_TRANSFORM_TYPES: ReadonlySet<TransformCommand['type']> = new Set([
  'filter',
  'removeEmptyRows',
  'splitColumn',
  'combineColumns',
  'findReplace',
  'dateConversion',
  'numberConversion',
  'currencyConversion',
  'prefix',
  'suffix',
  'fixedValue',
  'calculatedColumn',
  'conditionalRule',
  'editCell',
]);

function isRowBatchedTransform(command: TransformCommand): boolean {
  return ROW_BATCHED_TRANSFORM_TYPES.has(command.type);
}

export function createDataWorkerDispatcher(
  emit: (response: WorkerResponse) => void,
  cancellation = new CancellationRegistry(),
): DataWorkerDispatcher {
  const ensureNotCancelled = (operationId: string) => {
    if (cancellation.isCancelled(operationId)) {
      throw new OperationCancelled();
    }
  };

  const emitProgress = (
    operationId: string,
    completed: number,
    total: number,
    phase: WorkerPhase,
  ) => emit({ type: 'PROGRESS', operationId, completed, total, phase });

  const runBatches = async (
    operationId: string,
    total: number,
    requestedBatchSize: number | undefined,
    phase: WorkerPhase,
    processBatch: (start: number, end: number) => void,
  ): Promise<void> => {
    const batchSize = normalizeBatchSize(requestedBatchSize);
    if (total === 0) {
      ensureNotCancelled(operationId);
      emitProgress(operationId, 0, 0, phase);
      return;
    }

    for (let start = 0; start < total; start += batchSize) {
      ensureNotCancelled(operationId);
      const end = Math.min(total, start + batchSize);
      processBatch(start, end);
      emitProgress(operationId, end, total, phase);
      await yieldToMessageLoop();
      ensureNotCancelled(operationId);
    }
  };

  const dispatch = async (request: WorkerRequest): Promise<void> => {
    try {
      ensureNotCancelled(request.operationId);
      const result = await dispatchRequest(request, runBatches, ensureNotCancelled, emitProgress);
      ensureNotCancelled(request.operationId);
      emit({ type: 'RESULT', operationId: request.operationId, result });
    } catch (error) {
      if (error instanceof OperationCancelled || cancellation.isCancelled(request.operationId)) {
        emit({ type: 'CANCELLED', operationId: request.operationId });
      } else {
        emit({
          type: 'ERROR',
          operationId: request.operationId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      cancellation.clear(request.operationId);
    }
  };

  return {
    dispatch,
    cancel: (operationId) => cancellation.cancel(operationId),
  };
}

export function installDataWorker(scope: WorkerScope): DataWorkerDispatcher {
  const dispatcher = createDataWorkerDispatcher((response) => postWorkerResponse(scope, response));
  scope.addEventListener('message', (event) => {
    if (isWorkerControlMessage(event.data)) {
      dispatcher.cancel(event.data.operationId);
      return;
    }
    void dispatcher.dispatch(event.data);
  });
  return dispatcher;
}

async function dispatchRequest(
  request: WorkerRequest,
  runBatches: (
    operationId: string,
    total: number,
    requestedBatchSize: number | undefined,
    phase: WorkerPhase,
    processBatch: (start: number, end: number) => void,
  ) => Promise<void>,
  ensureNotCancelled: (operationId: string) => void,
  reportProgress: (operationId: string, completed: number, total: number, phase: WorkerPhase) => void,
): Promise<WorkerResult> {
  switch (request.type) {
    case 'IMPORT_SOURCE': {
      ensureNotCancelled(request.operationId);
      const file = new File([request.source.buffer], request.source.name, {
        type: request.source.mediaType ?? '',
      });
      const dataset = await readSource(file, request.options);
      ensureNotCancelled(request.operationId);
      return { type: 'IMPORT_SOURCE', dataset };
    }
    case 'LIST_SOURCE_SHEETS': {
      ensureNotCancelled(request.operationId);
      const file = new File([request.source.buffer], request.source.name, {
        type: request.source.mediaType ?? '',
      });
      const sheetNames = await listSourceSheets(file);
      ensureNotCancelled(request.operationId);
      return { type: 'LIST_SOURCE_SHEETS', sheetNames };
    }
    case 'INDEX_TEMPLATE': {
      ensureNotCancelled(request.operationId);
      const index = await indexWorkbook(await openOoxmlPackage(request.templateBuffer));
      ensureNotCancelled(request.operationId);
      return { type: 'INDEX_TEMPLATE', index };
    }
    case 'EXTRACT_DESTINATION': {
      ensureNotCancelled(request.operationId);
      const dataset = extractDestinationDataset(
        request.templateBuffer,
        request.sheetName,
        request.range,
      );
      ensureNotCancelled(request.operationId);
      return { type: 'EXTRACT_DESTINATION', dataset };
    }
    case 'APPLY_TRANSFORMS': {
      let dataset = request.dataset;
      const batchSize = normalizeBatchSize(request.batchSize);
      for (const command of request.commands) {
        ensureNotCancelled(request.operationId);
        if (isRowBatchedTransform(command)) {
          dataset = await applyTransformInRowBatches(
            dataset,
            command,
            request.operationId,
            batchSize,
            runBatches,
          );
          continue;
        }
        if (command.type === 'sort') {
          dataset = await applySortInBatches(
            dataset,
            command,
            request.operationId,
            batchSize,
            ensureNotCancelled,
            reportProgress,
          );
          continue;
        }
        if (command.type === 'deduplicate') {
          dataset = await applyDeduplicateInBatches(
            dataset,
            command,
            request.operationId,
            batchSize,
            runBatches,
          );
          continue;
        }
        dataset = applyTransform(dataset, command);
      }
      return { type: 'APPLY_TRANSFORMS', dataset };
    }
    case 'VALIDATE': {
      const localRules = request.rules.filter((rule) => rule.type !== 'unique' && rule.type !== 'compositeUnique');
      const issues = [] as ReturnType<typeof validateRow>;
      await runBatches(
        request.operationId,
        request.dataset.rows.length,
        request.batchSize,
        'validate',
        (start, end) => {
          for (const row of request.dataset.rows.slice(start, end)) {
            issues.push(...validateRow(row, localRules));
          }
        },
      );
      ensureNotCancelled(request.operationId);
      const uniquenessRules = request.rules.filter((rule) => rule.type === 'unique' || rule.type === 'compositeUnique');
      for (const rule of uniquenessRules) {
        issues.push(...await validateUniqueRuleInBatches(
          request.dataset,
          rule,
          request.operationId,
          normalizeBatchSize(request.batchSize),
          runBatches,
        ));
      }
      const conditionalRules = request.rules.filter((rule): rule is ConditionalMatrixRule => rule.type === 'conditionalMatrix');
      for (const rule of conditionalRules) {
        issues.push(...await validateConditionalUniqueInBatches(
          request.dataset,
          rule,
          request.operationId,
          normalizeBatchSize(request.batchSize),
          runBatches,
        ));
      }
      return {
        type: 'VALIDATE',
        validationResult: { isValid: issues.every(({ severity }) => (severity ?? 'error') !== 'error'), issues },
      };
    }
    case 'PLAN_WRITE': {
      ensureNotCancelled(request.operationId);
      const writePlan = await planWriteInBatches(request.input, {
        batchSize: normalizeBatchSize(request.batchSize),
        onProgress: async ({ completed, total, phase }) => {
          ensureNotCancelled(request.operationId);
          reportProgress(request.operationId, completed, total, phase);
          await yieldToMessageLoop();
          ensureNotCancelled(request.operationId);
        },
      });
      ensureNotCancelled(request.operationId);
      return { type: 'PLAN_WRITE', writePlan };
    }
    case 'EXPORT': {
      ensureNotCancelled(request.operationId);
      const packageForExport = await openOoxmlPackage(request.templateBuffer);
      ensureNotCancelled(request.operationId);
      const blob = await exportWorkbook(
        { ...request.input, package: packageForExport },
        {
          batchSize: normalizeBatchSize(request.batchSize),
          onProgress: async ({ completed, total, phase }) => {
            const workerPhase = phase === 'write'
              ? 'export'
              : phase === 'expansion' ? 'export-expansion' : 'export-rejected';
            ensureNotCancelled(request.operationId);
            reportProgress(request.operationId, completed, total, workerPhase);
            await yieldToMessageLoop();
            ensureNotCancelled(request.operationId);
          },
        },
      );
      const buffer = await blob.arrayBuffer();
      ensureNotCancelled(request.operationId);
      return { type: 'EXPORT', buffer };
    }
    case 'SCAN_EXPORT_RISKS': {
      ensureNotCancelled(request.operationId);
      const packageForScan = await openOoxmlPackage(request.templateBuffer);
      ensureNotCancelled(request.operationId);
      const risks = await scanExportRisks({ ...request.input, package: packageForScan });
      ensureNotCancelled(request.operationId);
      return { type: 'EXPORT_RISKS', risks };
    }
    default: return assertNever(request);
  }
}

function normalizeBatchSize(batchSize: number | undefined): number {
  const value = batchSize ?? DEFAULT_WORKER_BATCH_SIZE;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('batchSize deve ser um número inteiro positivo.');
  }
  return value;
}

async function applyTransformInRowBatches(
  dataset: Dataset,
  command: TransformCommand,
  operationId: string,
  batchSize: number,
  runBatches: (
    operationId: string,
    total: number,
    requestedBatchSize: number | undefined,
    phase: WorkerPhase,
    processBatch: (start: number, end: number) => void,
  ) => Promise<void>,
): Promise<Dataset> {
  if (dataset.rows.length === 0) {
    return applyTransform(dataset, command);
  }
  if (command.type === 'editCell' && !dataset.rows.some((row) => row.rowId === command.rowId)) {
    throw new RangeError(`Linha desconhecida: ${command.rowId}`);
  }

  const rows: DataRow[] = [];
  let columns = dataset.columns;
  await runBatches(
    operationId,
    dataset.rows.length,
    batchSize,
    'transform',
    (start, end) => {
      const chunkRows = dataset.rows.slice(start, end);
      const containsEditedRow = command.type === 'editCell'
        && chunkRows.some((row) => row.rowId === command.rowId);
      const transformed = command.type === 'editCell' && !containsEditedRow
        ? { columns, rows: chunkRows }
        : applyTransform({ columns: dataset.columns, rows: chunkRows }, command);
      columns = transformed.columns;
      rows.push(...transformed.rows);
    },
  );
  return { columns, rows };
}

async function applySortInBatches(
  dataset: Dataset,
  command: Extract<TransformCommand, { type: 'sort' }>,
  operationId: string,
  batchSize: number,
  ensureNotCancelled: (operationId: string) => void,
  reportProgress: (operationId: string, completed: number, total: number, phase: WorkerPhase) => void,
): Promise<Dataset> {
  applyTransform({ columns: dataset.columns, rows: [] }, command);
  if (dataset.rows.length < 2) return dataset;
  let source = [...dataset.rows];
  let target = new Array<DataRow>(source.length);

  for (let width = 1; width < source.length; width *= 2) {
    let completed = 0;
    for (let left = 0; left < source.length; left += width * 2) {
      const middle = Math.min(left + width, source.length);
      const right = Math.min(left + width * 2, source.length);
      let leftIndex = left;
      let rightIndex = middle;
      for (let output = left; output < right; output += 1) {
        target[output] = rightIndex >= right
          || (leftIndex < middle && compareDataRows(source[leftIndex], source[rightIndex], command.sorts) <= 0)
          ? source[leftIndex++]
          : source[rightIndex++];
        completed += 1;
        if (completed % batchSize === 0) {
          ensureNotCancelled(operationId);
          reportProgress(operationId, completed, source.length, 'transform');
          await yieldToMessageLoop();
          ensureNotCancelled(operationId);
        }
      }
    }
    if (completed % batchSize !== 0) {
      reportProgress(operationId, completed, source.length, 'transform');
      await yieldToMessageLoop();
      ensureNotCancelled(operationId);
    }
    [source, target] = [target, source];
  }
  return { columns: dataset.columns, rows: source };
}

async function applyDeduplicateInBatches(
  dataset: Dataset,
  command: Extract<TransformCommand, { type: 'deduplicate' }>,
  operationId: string,
  batchSize: number,
  runBatches: (
    operationId: string,
    total: number,
    requestedBatchSize: number | undefined,
    phase: WorkerPhase,
    processBatch: (start: number, end: number) => void,
  ) => Promise<void>,
): Promise<Dataset> {
  applyTransform({ columns: dataset.columns, rows: [] }, command);
  if (command.keep === 'first') {
    const seen = new Set<string>();
    const rows: DataRow[] = [];
    await runBatches(operationId, dataset.rows.length, batchSize, 'transform', (start, end) => {
      for (let index = start; index < end; index += 1) {
        const row = dataset.rows[index];
        const key = transformKey(command.columnIds.map((columnId) => row.values[columnId]));
        if (!seen.has(key)) {
          seen.add(key);
          rows.push(row);
        }
      }
    });
    return { columns: dataset.columns, rows };
  }

  const lastIndexByKey = new Map<string, number>();
  await runBatches(operationId, dataset.rows.length, batchSize, 'transform', (start, end) => {
    for (let index = start; index < end; index += 1) {
      const row = dataset.rows[index];
      lastIndexByKey.set(
        transformKey(command.columnIds.map((columnId) => row.values[columnId])),
        index,
      );
    }
  });
  const rows: DataRow[] = [];
  await runBatches(operationId, dataset.rows.length, batchSize, 'transform', (start, end) => {
    for (let index = start; index < end; index += 1) {
      const row = dataset.rows[index];
      const key = transformKey(command.columnIds.map((columnId) => row.values[columnId]));
      if (lastIndexByKey.get(key) === index) rows.push(row);
    }
  });
  return { columns: dataset.columns, rows };
}

function transformKey(values: readonly (CellValue | undefined)[]): string {
  return JSON.stringify(values.map((value) => [typeof value, value]));
}

async function validateUniqueRuleInBatches(
  dataset: Dataset,
  rule: Extract<ValidationRule, { type: 'unique' | 'compositeUnique' }>,
  operationId: string,
  batchSize: number,
  runBatches: (
    operationId: string,
    total: number,
    requestedBatchSize: number | undefined,
    phase: WorkerPhase,
    processBatch: (start: number, end: number) => void,
  ) => Promise<void>,
): Promise<ValidationIssue[]> {
  if (rule.type === 'compositeUnique' && rule.columnIds.length === 0) {
    return [];
  }

  const groups = new Map<string, DataRow[]>();
  await runBatches(
    operationId,
    dataset.rows.length,
    batchSize,
    'validate-unique',
    (start, end) => {
      for (const row of dataset.rows.slice(start, end)) {
        const values = rule.type === 'unique'
          ? [row.values[rule.columnId] ?? null]
          : rule.columnIds.map((columnId) => row.values[columnId] ?? null);
        if (values.some(isValidationEmpty)) continue;
        const key = stableValidationKey(values);
        const rows = groups.get(key);
        if (rows) rows.push(row);
        else groups.set(key, [row]);
      }
    },
  );

  const duplicateGroups = [...groups.values()].filter((rows) => rows.length > 1);
  const issues: ValidationIssue[] = [];
  const duplicateRowTotal = duplicateGroups.reduce((total, rows) => total + rows.length, 0);
  await runBatches(
    operationId,
    duplicateRowTotal,
    batchSize,
    'validate-unique-output',
    (start, end) => {
      let groupStart = 0;
      for (const rows of duplicateGroups) {
        const groupEnd = groupStart + rows.length;
        const rowStart = Math.max(start, groupStart) - groupStart;
        const rowEnd = Math.min(end, groupEnd) - groupStart;
        for (let index = Math.max(0, rowStart); index < Math.max(0, rowEnd); index += 1) {
          const row = rows[index];
          const columnId = rule.type === 'unique' ? rule.columnId : rule.columnIds[0];
          issues.push({
            rowId: row.rowId,
            sourceRowNumber: row.sourceRowNumber,
            columnId,
            code: rule.type === 'unique' ? 'unique' : 'composite_unique',
            value: row.values[columnId] ?? null,
            message: rule.type === 'unique' ? 'O valor deve ser único.' : 'Os valores combinados devem ser únicos.',
            severity: 'error',
          });
        }
        groupStart = groupEnd;
        if (groupStart >= end) break;
      }
    },
  );
  return issues;
}

async function validateConditionalUniqueInBatches(
  dataset: Dataset,
  rule: ConditionalMatrixRule,
  operationId: string,
  batchSize: number,
  runBatches: (
    operationId: string,
    total: number,
    requestedBatchSize: number | undefined,
    phase: WorkerPhase,
    processBatch: (start: number, end: number) => void,
  ) => Promise<void>,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const entry of rule.entries) {
    for (const columnId of rule.dependentColumnIds) {
      const constraint = entry.constraints[columnId];
      if (!constraint || (constraint.type !== 'unique' && constraint.type !== 'compositeUnique')) continue;
      const columnIds = constraint.type === 'compositeUnique' ? constraint.columnIds : [columnId];
      if (columnIds.length === 0) continue;
      const groups = new Map<string, DataRow[]>();
      await runBatches(
        operationId,
        dataset.rows.length,
        batchSize,
        'validate-unique',
        (start, end) => {
          for (const row of dataset.rows.slice(start, end)) {
            if (!matchesConditionalMatrixEntry(row, rule, entry)) continue;
            const values = columnIds.map((current) => row.values[current] ?? null);
            if (values.some(isValidationEmpty)) continue;
            const key = stableValidationKey(values);
            const rows = groups.get(key);
            if (rows) rows.push(row);
            else groups.set(key, [row]);
          }
        },
      );
      const duplicateGroups = [...groups.values()].filter((rows) => rows.length > 1);
      const duplicateRowTotal = duplicateGroups.reduce((total, rows) => total + rows.length, 0);
      await runBatches(
        operationId,
        duplicateRowTotal,
        batchSize,
        'validate-unique-output',
        (start, end) => {
          let groupStart = 0;
          for (const rows of duplicateGroups) {
            const groupEnd = groupStart + rows.length;
            const rowStart = Math.max(start, groupStart) - groupStart;
            const rowEnd = Math.min(end, groupEnd) - groupStart;
            for (let index = Math.max(0, rowStart); index < Math.max(0, rowEnd); index += 1) {
              const row = rows[index];
              issues.push({
                rowId: row.rowId,
                sourceRowNumber: row.sourceRowNumber,
                columnId: columnIds[0],
                code: constraint.type === 'unique' ? 'conditional_unique' : 'conditional_composite_unique',
                value: row.values[columnIds[0]] ?? null,
                message: constraint.type === 'unique'
                  ? 'O valor deve ser único no contexto condicional.'
                  : 'Os valores combinados devem ser únicos no contexto condicional.',
                severity: 'warning',
              });
            }
            groupStart = groupEnd;
            if (groupStart >= end) break;
          }
        },
      );
    }
  }
  return issues;
}

function isValidationEmpty(value: CellValue): boolean {
  return value === null || (typeof value === 'string' && value.trim() === '');
}

function stableValidationKey(values: readonly CellValue[]): string {
  return JSON.stringify(values.map((value) => [typeof value, value]));
}

function yieldToMessageLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assertNever(value: never): never {
  throw new Error(`Solicitação do processador não tratada: ${JSON.stringify(value)}`);
}

const currentScope = globalThis as Partial<WorkerScope>;
if (
  typeof document === 'undefined'
  && typeof currentScope.addEventListener === 'function'
  && typeof currentScope.postMessage === 'function'
) {
  installDataWorker(currentScope as WorkerScope);
}
