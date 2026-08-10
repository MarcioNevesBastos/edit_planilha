import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { DataRow, Dataset } from '../../../src/domain/dataset/types';
import type { WorkerResponse } from '../../../src/workers/protocol';
import { createDataWorkerDispatcher } from '../../../src/workers/data-worker';

function row(rowId: string, sourceRowNumber: number, values: DataRow['values']): DataRow {
  return { rowId, sourceRowNumber, values, originalValues: { ...values } };
}

function dataset(rows: DataRow[]): Dataset {
  return {
    columns: [{ id: 'name__1', header: 'Name', sourceIndex: 0, detectedType: 'string' }],
    rows,
  };
}

describe('data worker dispatcher', () => {
  it('dispatches each dependency operation with operation-scoped results', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => messages.push(message));
    const source = new TextEncoder().encode('Name\nAna\n').buffer;
    const input: Dataset = dataset([row('new-1', 2, { name__1: 'Ana' })]);

    await dispatcher.dispatch({
      type: 'IMPORT_SOURCE', operationId: 'import', source: { name: 'source.csv', buffer: source },
    });
    await dispatcher.dispatch({
      type: 'APPLY_TRANSFORMS', operationId: 'transform', dataset: input, commands: [{ type: 'prefix', columnId: 'name__1', value: 'Dr. ' }],
    });
    await dispatcher.dispatch({
      type: 'VALIDATE', operationId: 'validate', dataset: input, rules: [{ type: 'required', columnId: 'name__1' }],
    });
    await dispatcher.dispatch({
      type: 'PLAN_WRITE',
      operationId: 'plan',
      input: { mode: 'append', incoming: input, existing: dataset([]), destination: { headerRow: 1, dataStartRow: 2 } },
    });

    expect(messages.filter((message) => message.type === 'RESULT').map((message) => [
      message.operationId,
      message.result.type,
    ])).toEqual([
      ['import', 'IMPORT_SOURCE'],
      ['transform', 'APPLY_TRANSFORMS'],
      ['validate', 'VALIDATE'],
      ['plan', 'PLAN_WRITE'],
    ]);
    const transform = messages.find((message) => message.type === 'RESULT' && message.operationId === 'transform');
    expect(transform).toMatchObject({ result: { dataset: { rows: [{ values: { name__1: 'Dr. Ana' } }] } } });
    const plan = messages.find((message) => message.type === 'RESULT' && message.operationId === 'plan');
    expect(plan).toMatchObject({ result: { writePlan: { inserts: [{ destinationRow: 2 }] } } });
  });

  it('emits row-batch progress and cancels only the requested operation before success', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => {
      messages.push(message);
      if (message.type === 'PROGRESS' && message.operationId === 'cancel-me' && message.completed === 1) {
        dispatcher.cancel('cancel-me');
      }
    });
    const input = dataset([
      row('r-1', 2, { name__1: 'Ana' }),
      row('r-2', 3, { name__1: 'Bia' }),
      row('r-3', 4, { name__1: 'Caio' }),
    ]);

    await Promise.all([
      dispatcher.dispatch({
        type: 'VALIDATE', operationId: 'cancel-me', dataset: input, rules: [{ type: 'required', columnId: 'name__1' }], batchSize: 1,
      }),
      dispatcher.dispatch({
        type: 'VALIDATE', operationId: 'keep-running', dataset: input, rules: [{ type: 'required', columnId: 'name__1' }], batchSize: 1,
      }),
    ]);

    expect(messages.filter((message): message is Extract<WorkerResponse, { type: 'PROGRESS' }> => (
      message.type === 'PROGRESS' && message.operationId === 'cancel-me'
    ))
      .map((message) => message.completed)).toEqual([1]);
    expect(messages).toContainEqual({ type: 'CANCELLED', operationId: 'cancel-me' });
    expect(messages.some((message) => message.type === 'RESULT' && message.operationId === 'cancel-me')).toBe(false);
    expect(messages).toContainEqual({
      type: 'RESULT', operationId: 'keep-running', result: { type: 'VALIDATE', validationResult: { isValid: true, issues: [] } },
    });
  });

  it('batches a row-wide transform by dataset rows and cancels between row batches', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => {
      messages.push(message);
      if (message.type === 'PROGRESS' && message.operationId === 'transform-large' && message.completed === 1) {
        dispatcher.cancel('transform-large');
      }
    });
    const input = dataset(Array.from({ length: 5 }, (_, index) => row(
      `r-${index + 1}`,
      index + 2,
      { name__1: `Name ${index + 1}` },
    )));

    await dispatcher.dispatch({
      type: 'APPLY_TRANSFORMS',
      operationId: 'transform-large',
      dataset: input,
      commands: [{ type: 'prefix', columnId: 'name__1', value: 'X ' }],
      batchSize: 1,
    });

    expect(messages).toContainEqual({
      type: 'PROGRESS', operationId: 'transform-large', completed: 1, total: 5, phase: 'transform',
    });
    expect(messages).toContainEqual({ type: 'CANCELLED', operationId: 'transform-large' });
    expect(messages.some((message) => message.type === 'RESULT' && message.operationId === 'transform-large')).toBe(false);
  });

  it('observes cancellation while building and reporting uniqueness results in row batches', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => {
      messages.push(message);
      if (message.type === 'PROGRESS' && message.operationId === 'unique-large' && message.phase === 'validate-unique' && message.completed === 1) {
        dispatcher.cancel('unique-large');
      }
    });
    const input = dataset(Array.from({ length: 5 }, (_, index) => row(
      `r-${index + 1}`,
      index + 2,
      { name__1: index % 2 === 0 ? 'Repeated' : `Name ${index + 1}` },
    )));

    await dispatcher.dispatch({
      type: 'VALIDATE',
      operationId: 'unique-large',
      dataset: input,
      rules: [{ type: 'unique', columnId: 'name__1' }],
      batchSize: 1,
    });

    expect(messages).toContainEqual({
      type: 'PROGRESS', operationId: 'unique-large', completed: 1, total: 5, phase: 'validate-unique',
    });
    expect(messages).toContainEqual({ type: 'CANCELLED', operationId: 'unique-large' });
    expect(messages.some((message) => message.type === 'RESULT' && message.operationId === 'unique-large')).toBe(false);
  });

  it('preserves Task 5 uniqueness issue ordering after batched validation', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => messages.push(message));
    const input = dataset([
      row('r-a1', 2, { name__1: 'A' }),
      row('r-b1', 3, { name__1: 'B' }),
      row('r-b2', 4, { name__1: 'B' }),
      row('r-a2', 5, { name__1: 'A' }),
    ]);

    await dispatcher.dispatch({
      type: 'VALIDATE',
      operationId: 'unique-order',
      dataset: input,
      rules: [{ type: 'unique', columnId: 'name__1' }],
      batchSize: 2,
    });

    expect(messages).toContainEqual({
      type: 'RESULT',
      operationId: 'unique-order',
      result: {
        type: 'VALIDATE',
        validationResult: {
          isValid: false,
          issues: [
            expect.objectContaining({ rowId: 'r-a1', code: 'unique' }),
            expect.objectContaining({ rowId: 'r-a2', code: 'unique' }),
            expect.objectContaining({ rowId: 'r-b1', code: 'unique' }),
            expect.objectContaining({ rowId: 'r-b2', code: 'unique' }),
          ],
        },
      },
    });
  });

  it('routes a small export request through the Task 9 exporter', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => messages.push(message));
    const fixture = await readFile(new URL('../../../src/test-fixtures/workbooks/template-structured.xlsx', import.meta.url));
    const templateBuffer = fixture.buffer.slice(
      fixture.byteOffset,
      fixture.byteOffset + fixture.byteLength,
    ) as ArrayBuffer;

    await dispatcher.dispatch({
      type: 'EXPORT',
      operationId: 'export-small',
      templateBuffer,
      input: {
        destination: {
          sheetName: 'Dados Modelo',
          range: 'A2:D5',
          dataStartRow: 3,
          templateRow: 5,
          tablePath: 'xl/tables/table1.xml',
          columns: [
            { id: 'target_id', column: 'A' },
            { id: 'target_product', column: 'B' },
            { id: 'target_quantity', column: 'C' },
            { id: 'target_price', column: 'D' },
          ],
        },
        mappings: [
          { sourceColumnId: 'source_id', destinationColumnId: 'target_id', confidence: 'exact', score: 1, status: 'accepted' },
          { sourceColumnId: 'source_product', destinationColumnId: 'target_product', confidence: 'exact', score: 1, status: 'accepted' },
          { sourceColumnId: 'source_quantity', destinationColumnId: 'target_quantity', confidence: 'exact', score: 1, status: 'accepted' },
          { sourceColumnId: 'source_price', destinationColumnId: 'target_price', confidence: 'exact', score: 1, status: 'accepted' },
        ],
        writePlan: {
          mode: 'replace',
          headerRow: 2,
          clears: [],
          inserts: [{
            incomingRowId: 'incoming-1',
            destinationRow: 3,
            values: { source_id: 10, source_product: 'Pencil', source_quantity: 2, source_price: 1.5 },
          }],
          updates: [],
          kept: [],
          duplicates: [],
          rejected: [],
          assignments: [{ kind: 'insert', incomingRowId: 'incoming-1', destinationRow: 3 }],
        },
        validationResult: { isValid: true, issues: [] },
      },
    });

    expect(messages).toContainEqual(expect.objectContaining({
      type: 'RESULT',
      operationId: 'export-small',
      result: expect.objectContaining({ type: 'EXPORT' }),
    }));
  });

  it('blocks an export request larger than its configured row budget before opening the package', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => messages.push(message));

    await dispatcher.dispatch({
      type: 'EXPORT',
      operationId: 'export-large',
      templateBuffer: new ArrayBuffer(1),
      batchSize: 1,
      input: {
        destination: {
          sheetName: 'Data',
          range: 'A1:A3',
          dataStartRow: 2,
          templateRow: 2,
          columns: [{ id: 'target_name', column: 'A' }],
        },
        mappings: [],
        writePlan: {
          mode: 'append',
          headerRow: 1,
          clears: [],
          inserts: [
            { incomingRowId: 'r-1', destinationRow: 2, values: { name__1: 'Ana' } },
            { incomingRowId: 'r-2', destinationRow: 3, values: { name__1: 'Bia' } },
          ],
          updates: [],
          kept: [],
          duplicates: [],
          rejected: [],
          assignments: [
            { kind: 'insert', incomingRowId: 'r-1', destinationRow: 2 },
            { kind: 'insert', incomingRowId: 'r-2', destinationRow: 3 },
          ],
        },
        validationResult: { isValid: true, issues: [] },
      },
    });

    expect(messages).toContainEqual(expect.objectContaining({
      type: 'ERROR',
      operationId: 'export-large',
      message: expect.stringContaining('exceeds the worker row budget'),
    }));
    expect(messages.some((message) => message.type === 'RESULT' && message.operationId === 'export-large')).toBe(false);
  });

  it('blocks a plan-write request larger than its configured row budget before planning', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => messages.push(message));
    const input = dataset([
      row('r-1', 2, { name__1: 'Ana' }),
      row('r-2', 3, { name__1: 'Bia' }),
    ]);

    await dispatcher.dispatch({
      type: 'PLAN_WRITE',
      operationId: 'plan-large',
      batchSize: 1,
      input: {
        mode: 'append',
        incoming: input,
        existing: dataset([]),
        destination: { headerRow: 1, dataStartRow: 2 },
      },
    });

    expect(messages).toContainEqual(expect.objectContaining({
      type: 'ERROR',
      operationId: 'plan-large',
      message: expect.stringContaining('exceeds the worker row budget'),
    }));
    expect(messages.some((message) => message.type === 'RESULT' && message.operationId === 'plan-large')).toBe(false);
  });
});
