import { CancellationRegistry } from '../utils/cancellation';
import type { Dataset } from '../domain/dataset/types';
import { planWrite } from '../domain/merge/plan-write';
import { applyTransform } from '../domain/transforms/apply-transform';
import { validateDataset, validateRow } from '../domain/validation/validate-row';
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
      await runBatches(
        request.operationId,
        request.commands.length,
        request.batchSize,
        'transform',
        (start, end) => {
          for (const command of request.commands.slice(start, end)) {
            dataset = applyTransform(dataset, command);
          }
        },
      );
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
      issues.push(...validateDataset(request.dataset, uniquenessRules).issues);
      return {
        type: 'VALIDATE',
        validationResult: { isValid: issues.length === 0, issues },
      };
    }
    case 'PLAN_WRITE': {
      ensureNotCancelled(request.operationId);
      const writePlan = planWrite(request.input);
      ensureNotCancelled(request.operationId);
      return { type: 'PLAN_WRITE', writePlan };
    }
    case 'EXPORT': {
      ensureNotCancelled(request.operationId);
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
