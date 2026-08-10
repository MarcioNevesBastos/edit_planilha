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
});
