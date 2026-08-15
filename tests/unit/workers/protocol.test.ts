import { describe, expect, it } from 'vitest';
import type { Dataset } from '../../../src/domain/dataset/types';
import type { WorkerRequest, WorkerResponse } from '../../../src/workers/protocol';
import {
  transferablesForRequest,
  transferablesForResponse,
} from '../../../src/workers/protocol';

const dataset: Dataset = {
  columns: [],
  rows: [],
};

function assertNever(value: never): never {
  throw new Error(`Unhandled message: ${JSON.stringify(value)}`);
}

function requestLabel(request: WorkerRequest): string {
  switch (request.type) {
    case 'IMPORT_SOURCE': return request.type;
    case 'LIST_SOURCE_SHEETS': return request.type;
    case 'INDEX_TEMPLATE': return request.type;
    case 'EXTRACT_DESTINATION': return request.type;
    case 'PREPARE_OUTPUT_BASE': return request.type;
    case 'APPLY_TRANSFORMS': return request.type;
    case 'VALIDATE': return request.type;
    case 'PLAN_WRITE': return request.type;
    case 'SCAN_EXPORT_RISKS': return request.type;
    case 'EXPORT': return request.type;
    default: return assertNever(request);
  }
}

function responseLabel(response: WorkerResponse): string {
  switch (response.type) {
    case 'PROGRESS': return response.type;
    case 'RESULT': return response.type;
    case 'ERROR': return response.type;
    case 'CANCELLED': return response.type;
    default: return assertNever(response);
  }
}

describe('worker protocol', () => {
  it('requires exhaustive handling for every request and response discriminator', () => {
    const sourceBuffer = new ArrayBuffer(8);
    const templateBuffer = new ArrayBuffer(8);
    const requests: WorkerRequest[] = [
      { type: 'IMPORT_SOURCE', operationId: 'import', source: { name: 'source.csv', buffer: sourceBuffer } },
      { type: 'LIST_SOURCE_SHEETS', operationId: 'list', source: { name: 'source.xlsx', buffer: sourceBuffer } },
      { type: 'INDEX_TEMPLATE', operationId: 'index', templateBuffer },
      { type: 'EXTRACT_DESTINATION', operationId: 'extract', templateBuffer, sheetName: 'Data', range: 'A1:A2' },
      { type: 'PREPARE_OUTPUT_BASE', operationId: 'prepare-base', mode: 'none', columns: [] },
      { type: 'APPLY_TRANSFORMS', operationId: 'transform', dataset, commands: [] },
      { type: 'VALIDATE', operationId: 'validate', dataset, rules: [] },
      {
        type: 'PLAN_WRITE',
        operationId: 'plan',
        input: {
          mode: 'replace',
          incoming: dataset,
          existing: dataset,
          destination: { headerRow: 1, dataStartRow: 2 },
        },
      },
      {
        type: 'SCAN_EXPORT_RISKS',
        operationId: 'risks',
        templateBuffer,
        input: {
          destination: { sheetName: 'Data', range: 'A1:A2', dataStartRow: 2, templateRow: 2, columns: [] },
          mappings: [],
          writePlan: { mode: 'replace', headerRow: 1, clears: [], inserts: [], updates: [], kept: [], duplicates: [], rejected: [], assignments: [] },
          validationResult: { isValid: true, issues: [] },
        },
      },
      {
        type: 'EXPORT',
        operationId: 'export',
        templateBuffer,
        input: {
          destination: {
            sheetName: 'Data',
            range: 'A1:A2',
            dataStartRow: 2,
            templateRow: 2,
            columns: [],
          },
          mappings: [],
          writePlan: {
            mode: 'replace', headerRow: 1, clears: [], inserts: [], updates: [], kept: [], duplicates: [], rejected: [], assignments: [],
          },
          validationResult: { isValid: true, issues: [] },
        },
      },
    ];
    const responses: WorkerResponse[] = [
      { type: 'PROGRESS', operationId: 'progress', completed: 1, total: 2, phase: 'validate' },
      { type: 'RESULT', operationId: 'result', result: { type: 'VALIDATE', validationResult: { isValid: true, issues: [] } } },
      { type: 'ERROR', operationId: 'error', message: 'failure' },
      { type: 'CANCELLED', operationId: 'cancelled' },
    ];

    expect(requests.map(requestLabel)).toEqual([
      'IMPORT_SOURCE', 'LIST_SOURCE_SHEETS', 'INDEX_TEMPLATE', 'EXTRACT_DESTINATION', 'PREPARE_OUTPUT_BASE',
      'APPLY_TRANSFORMS', 'VALIDATE', 'PLAN_WRITE', 'SCAN_EXPORT_RISKS', 'EXPORT',
    ]);
    expect(responses.map(responseLabel)).toEqual(['PROGRESS', 'RESULT', 'ERROR', 'CANCELLED']);
  });

  it('transfers owned source and template buffers while progress carries no dataset copy', () => {
    const sourceBuffer = new ArrayBuffer(8);
    const templateBuffer = new ArrayBuffer(8);
    const importRequest: WorkerRequest = {
      type: 'IMPORT_SOURCE', operationId: 'import', source: { name: 'source.csv', buffer: sourceBuffer },
    };
    const exportRequest: WorkerRequest = {
      type: 'EXPORT',
      operationId: 'export',
      templateBuffer,
      input: {
        destination: { sheetName: 'Data', range: 'A1:A2', dataStartRow: 2, templateRow: 2, columns: [] },
        mappings: [],
        writePlan: {
          mode: 'replace', headerRow: 1, clears: [], inserts: [], updates: [], kept: [], duplicates: [], rejected: [], assignments: [],
        },
        validationResult: { isValid: true, issues: [] },
      },
    };
    const prepareRequest: WorkerRequest = {
      type: 'PREPARE_OUTPUT_BASE', operationId: 'prepare-base', mode: 'source', sourceBuffer, columns: [],
    };
    const progress: WorkerResponse = {
      type: 'PROGRESS', operationId: 'import', completed: 1, total: 2, phase: 'import',
    };
    const resultBuffer = new ArrayBuffer(8);
    const result: WorkerResponse = {
      type: 'RESULT', operationId: 'export', result: { type: 'EXPORT', buffer: resultBuffer },
    };

    expect(transferablesForRequest(importRequest)).toEqual([sourceBuffer]);
    expect(transferablesForRequest(exportRequest)).toEqual([templateBuffer]);
    expect(transferablesForRequest(prepareRequest)).toEqual([sourceBuffer]);
    expect(Object.keys(progress).sort()).toEqual(['completed', 'operationId', 'phase', 'total', 'type']);
    expect(transferablesForResponse(result)).toEqual([resultBuffer]);
  });
});
