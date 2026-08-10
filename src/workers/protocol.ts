import type { Dataset } from '../domain/dataset/types';
import type { WritePlan, WritePlanInput } from '../domain/merge/types';
import type { TransformCommand } from '../domain/transforms/types';
import type { ValidationResult, ValidationRule } from '../domain/validation/types';
import type { ExportInput, ExportRisk } from '../io/template/export-workbook';
import type { WorkbookIndex } from '../io/template/workbook-index';
import type { ReadSourceOptions } from '../io/source/types';

export const DEFAULT_WORKER_BATCH_SIZE = 1_000;

export type WorkerPhase = 'import' | 'transform' | 'validate' | 'validate-unique' | 'validate-unique-output' | 'plan' | 'plan-assign' | 'export' | 'export-expansion' | 'export-rejected';

interface WorkerRequestBase {
  operationId: string;
  batchSize?: number;
}

export interface SourceBuffer {
  name: string;
  buffer: ArrayBuffer;
  mediaType?: string;
}

export type WorkerRequest =
  | ({ type: 'IMPORT_SOURCE'; source: SourceBuffer; options?: ReadSourceOptions } & WorkerRequestBase)
  | ({ type: 'LIST_SOURCE_SHEETS'; source: SourceBuffer } & WorkerRequestBase)
  | ({ type: 'INDEX_TEMPLATE'; templateBuffer: ArrayBuffer } & WorkerRequestBase)
  | ({ type: 'EXTRACT_DESTINATION'; templateBuffer: ArrayBuffer; sheetName: string; range: string } & WorkerRequestBase)
  | ({ type: 'APPLY_TRANSFORMS'; dataset: Dataset; commands: readonly TransformCommand[] } & WorkerRequestBase)
  | ({ type: 'VALIDATE'; dataset: Dataset; rules: readonly ValidationRule[] } & WorkerRequestBase)
  | ({ type: 'PLAN_WRITE'; input: WritePlanInput } & WorkerRequestBase)
  | ({ type: 'SCAN_EXPORT_RISKS'; templateBuffer: ArrayBuffer; input: Omit<ExportInput, 'package'> } & WorkerRequestBase)
  | ({ type: 'EXPORT'; templateBuffer: ArrayBuffer; input: Omit<ExportInput, 'package'> } & WorkerRequestBase);

export type WorkerResult =
  | { type: 'IMPORT_SOURCE'; dataset: Dataset }
  | { type: 'LIST_SOURCE_SHEETS'; sheetNames: string[] }
  | { type: 'INDEX_TEMPLATE'; index: WorkbookIndex }
  | { type: 'EXTRACT_DESTINATION'; dataset: Dataset }
  | { type: 'APPLY_TRANSFORMS'; dataset: Dataset }
  | { type: 'VALIDATE'; validationResult: ValidationResult }
  | { type: 'PLAN_WRITE'; writePlan: WritePlan }
  | { type: 'EXPORT_RISKS'; risks: ExportRisk[] }
  | { type: 'EXPORT'; buffer: ArrayBuffer };

export type WorkerResponse =
  | { type: 'PROGRESS'; operationId: string; completed: number; total: number; phase: WorkerPhase }
  | { type: 'RESULT'; operationId: string; result: WorkerResult }
  | { type: 'ERROR'; operationId: string; message: string }
  | { type: 'CANCELLED'; operationId: string };

export type WorkerControlMessage = { type: 'CANCEL_OPERATION'; operationId: string };

export type WorkerInboundMessage = WorkerRequest | WorkerControlMessage;

export interface WorkerMessageTarget {
  postMessage(message: WorkerRequest | WorkerResponse, transfer?: Transferable[]): void;
}

export function transferablesForRequest(request: WorkerRequest): Transferable[] {
  switch (request.type) {
    case 'IMPORT_SOURCE': return [request.source.buffer];
    case 'LIST_SOURCE_SHEETS': return [request.source.buffer];
    case 'INDEX_TEMPLATE':
    case 'EXTRACT_DESTINATION':
    case 'SCAN_EXPORT_RISKS': return [request.templateBuffer];
    case 'EXPORT': return [request.templateBuffer];
    case 'APPLY_TRANSFORMS':
    case 'VALIDATE':
    case 'PLAN_WRITE': return [];
    default: return assertNever(request);
  }
}

export function transferablesForResponse(response: WorkerResponse): Transferable[] {
  switch (response.type) {
    case 'RESULT':
      return response.result.type === 'EXPORT' ? [response.result.buffer] : [];
    case 'PROGRESS':
    case 'ERROR':
    case 'CANCELLED': return [];
    default: return assertNever(response);
  }
}

export function postWorkerRequest(target: WorkerMessageTarget, request: WorkerRequest): void {
  target.postMessage(request, transferablesForRequest(request));
}

export function postWorkerResponse(target: WorkerMessageTarget, response: WorkerResponse): void {
  target.postMessage(response, transferablesForResponse(response));
}

export function isWorkerControlMessage(message: unknown): message is WorkerControlMessage {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'CANCEL_OPERATION'
    && typeof (message as { operationId?: unknown }).operationId === 'string';
}

function assertNever(value: never): never {
  throw new Error(`Unhandled worker protocol message: ${JSON.stringify(value)}`);
}
