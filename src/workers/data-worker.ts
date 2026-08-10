import { CancellationRegistry } from '../utils/cancellation';
import type { DataRow, Dataset } from '../domain/dataset/types';
import { planWrite } from '../domain/merge/plan-write';
import { applyTransform } from '../domain/transforms/apply-transform';
import type { TransformCommand } from '../domain/transforms/types';
import { validateRow } from '../domain/validation/validate-row';
import type { CellValue } from '../domain/dataset/types';
import type { ValidationIssue, ValidationRule } from '../domain/validation/types';
import { readSource } from '../io/source/read-source';
import { exportWorkbook } from '../io/template/export-workbook';
import { openOoxmlPackage } from '../io/template/ooxml-package';
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
    super('Operation cancelled');
  }
}

class UnsupportedLargeOperation extends Error {
  public constructor(operation: string, rowCount: number, batchSize: number) {
    super(`${operation} exceeds the worker row budget: ${rowCount} rows cannot be processed in batches of ${batchSize}.`);
  }
}

const ROW_BATCHED_TRANSFORM_TYPES: ReadonlySet<TransformCommand['type']> = new Set([
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
      const result = await dispatchRequest(request, runBatches, ensureNotCancelled);
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
        if (isRowHeavyTransform(command) && dataset.rows.length > batchSize) {
          throw new UnsupportedLargeOperation(`Transform ${command.type}`, dataset.rows.length, batchSize);
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
      return {
        type: 'VALIDATE',
        validationResult: { isValid: issues.length === 0, issues },
      };
    }
    case 'PLAN_WRITE': {
      ensureNotCancelled(request.operationId);
      assertWorkerRowBudget(
        'Plan write',
        Math.max(request.input.incoming.rows.length, request.input.existing.rows.length),
        request.batchSize,
      );
      const writePlan = planWrite(request.input);
      ensureNotCancelled(request.operationId);
      return { type: 'PLAN_WRITE', writePlan };
    }
    case 'EXPORT': {
      ensureNotCancelled(request.operationId);
      assertWorkerRowBudget(
        'Export',
        request.input.writePlan.clears.length
          + request.input.writePlan.inserts.length
          + request.input.writePlan.updates.length,
        request.batchSize,
      );
      const packageForExport = await openOoxmlPackage(request.templateBuffer);
      ensureNotCancelled(request.operationId);
      const blob = await exportWorkbook({ ...request.input, package: packageForExport });
      const buffer = await blob.arrayBuffer();
      ensureNotCancelled(request.operationId);
      return { type: 'EXPORT', buffer };
    }
    default: return assertNever(request);
  }
}

function normalizeBatchSize(batchSize: number | undefined): number {
  const value = batchSize ?? DEFAULT_WORKER_BATCH_SIZE;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('batchSize must be a positive whole number');
  }
  return value;
}

function assertWorkerRowBudget(operation: string, rowCount: number, batchSize: number | undefined): void {
  const normalizedBatchSize = normalizeBatchSize(batchSize);
  if (rowCount > normalizedBatchSize) {
    throw new UnsupportedLargeOperation(operation, rowCount, normalizedBatchSize);
  }
}

function isRowHeavyTransform(command: TransformCommand): boolean {
  return command.type === 'sort'
    || command.type === 'filter'
    || command.type === 'removeEmptyRows'
    || command.type === 'deduplicate';
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
    throw new RangeError(`Unknown row: ${command.rowId}`);
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
  await runBatches(
    operationId,
    duplicateGroups.length,
    batchSize,
    'validate-unique-output',
    (start, end) => {
      for (const rows of duplicateGroups.slice(start, end)) {
        for (const row of rows) {
          const columnId = rule.type === 'unique' ? rule.columnId : rule.columnIds[0];
          issues.push({
            rowId: row.rowId,
            sourceRowNumber: row.sourceRowNumber,
            columnId,
            code: rule.type === 'unique' ? 'unique' : 'composite_unique',
            value: row.values[columnId] ?? null,
            message: rule.type === 'unique' ? 'Value must be unique.' : 'Combined values must be unique.',
          });
        }
      }
    },
  );
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
  throw new Error(`Unhandled worker request: ${JSON.stringify(value)}`);
}

const currentScope = globalThis as Partial<WorkerScope>;
if (
  typeof document === 'undefined'
  && typeof currentScope.addEventListener === 'function'
  && typeof currentScope.postMessage === 'function'
) {
  installDataWorker(currentScope as WorkerScope);
}
