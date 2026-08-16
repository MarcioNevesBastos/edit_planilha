import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { DataRow, Dataset } from '../../../src/domain/dataset/types';
import { applyTransform } from '../../../src/domain/transforms/apply-transform';
import { openOoxmlPackage } from '../../../src/io/template/ooxml-package';
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

  it('prepares automatic output bases inside the worker', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => messages.push(message));
    const source = await readFile(new URL('../../../src/test-fixtures/workbooks/source-basic.xlsx', import.meta.url));
    const sourceBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;

    await dispatcher.dispatch({
      type: 'PREPARE_OUTPUT_BASE',
      operationId: 'prepare-none',
      mode: 'none',
      columns: dataset([]).columns,
    });
    await dispatcher.dispatch({
      type: 'PREPARE_OUTPUT_BASE',
      operationId: 'prepare-source',
      mode: 'source',
      sourceBuffer,
      columns: dataset([]).columns,
    });

    expect(messages).toContainEqual(expect.objectContaining({
      type: 'RESULT',
      operationId: 'prepare-none',
      result: expect.objectContaining({
        type: 'PREPARE_OUTPUT_BASE',
        destination: expect.objectContaining({ sheetName: 'Dados Preparados' }),
      }),
    }));
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'RESULT',
      operationId: 'prepare-source',
      result: expect.objectContaining({
        type: 'PREPARE_OUTPUT_BASE',
        destination: expect.objectContaining({ sheetName: 'Dados Preparados' }),
      }),
    }));
  });

  it('keeps conditional typed replacements equivalent across worker batches', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => messages.push(message));
    const input: Dataset = {
      columns: [
        { id: 'name__1', header: 'Name', sourceIndex: 0, detectedType: 'string' },
        { id: 'amount__1', header: 'Amount', sourceIndex: 1, detectedType: 'number' },
      ],
      rows: [
        row('r-1', 2, { name__1: 'Ana', amount__1: 10 }),
        row('r-2', 3, { name__1: 'Ana', amount__1: 2 }),
        row('r-3', 4, { name__1: 'Bia', amount__1: 10 }),
      ],
    };
    const command = {
      type: 'findReplace' as const,
      columnIds: ['name__1'],
      find: 'Ana',
      replace: 'Aline',
      when: { type: 'predicate' as const, columnId: 'amount__1', operator: 'greaterThan' as const, operand: { type: 'literal' as const, value: 5 } },
    };

    await dispatcher.dispatch({
      type: 'APPLY_TRANSFORMS',
      operationId: 'conditional-transform',
      dataset: input,
      commands: [command],
      batchSize: 1,
    });

    const response = messages.find((message): message is Extract<WorkerResponse, { type: 'RESULT' }> => (
      message.type === 'RESULT' && message.operationId === 'conditional-transform'
    ));
    expect(response?.result).toMatchObject({ type: 'APPLY_TRANSFORMS', dataset: applyTransform(input, command) });
    expect(messages.some((message) => message.type === 'PROGRESS' && message.operationId === 'conditional-transform' && message.phase === 'transform')).toBe(true);
  });

  it('validates conditional matrices in batches and preserves warning-only validity', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => messages.push(message));
    const input = dataset([
      row('r-1', 2, { name__1: 'PJ', cnpj__1: null }),
      row('r-2', 3, { name__1: 'PF', cnpj__1: null }),
    ]);

    await dispatcher.dispatch({
      type: 'VALIDATE',
      operationId: 'conditional-warning',
      dataset: input,
      rules: [{
        type: 'conditionalMatrix',
        keyColumnIds: ['name__1'],
        dependentColumnIds: ['cnpj__1'],
        entries: [{
          conditions: { name__1: { operator: 'equals', value: 'PJ' } },
          constraints: { cnpj__1: { type: 'required' } },
        }],
      }],
      batchSize: 1,
    });

    expect(messages).toContainEqual(expect.objectContaining({
      type: 'RESULT',
      operationId: 'conditional-warning',
      result: {
        type: 'VALIDATE',
        validationResult: expect.objectContaining({
          isValid: true,
          issues: expect.arrayContaining([
            expect.objectContaining({ rowId: 'r-1', code: 'conditional_required', severity: 'warning' }),
            expect.objectContaining({ rowId: 'r-2', code: 'conditional_no_match', severity: 'warning' }),
          ]),
        }),
      },
    }));
    expect(messages.some((message) => message.type === 'PROGRESS' && message.operationId === 'conditional-warning' && message.phase === 'validate')).toBe(true);
  });

  it('validates relations with external datasets inside the worker', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => messages.push(message));
    const input: Dataset = {
      columns: [{ id: 'code__1', header: 'Code', sourceIndex: 0, detectedType: 'string' }],
      rows: [row('incoming-1', 2, { code__1: 'A' }), row('incoming-2', 3, { code__1: 'B' })],
    };
    const catalog: Dataset = {
      columns: [{ id: 'catalog_code__1', header: 'Code', sourceIndex: 0, detectedType: 'string' }],
      rows: [row('catalog-1', 2, { catalog_code__1: 'A' })],
    };

    await dispatcher.dispatch({
      type: 'VALIDATE',
      operationId: 'relation-validation',
      dataset: input,
      referenceDatasets: { catalog },
      rules: [{
        type: 'relation',
        source: 'catalog',
        leftColumnIds: ['code__1'],
        rightColumnIds: ['catalog_code__1'],
        minMatches: 1,
      }],
    });

    expect(messages).toContainEqual(expect.objectContaining({
      type: 'RESULT',
      operationId: 'relation-validation',
      result: expect.objectContaining({
        type: 'VALIDATE',
        validationResult: expect.objectContaining({
          isValid: false,
          issues: [expect.objectContaining({ rowId: 'incoming-2', code: 'relation' })],
        }),
      }),
    }));
  });

  it('runs workbook sheet listing, indexing, and destination extraction inside the worker', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => messages.push(message));
    const source = await readFile(new URL('../../../src/test-fixtures/workbooks/source-basic.xlsx', import.meta.url));
    const template = await readFile(new URL('../../../src/test-fixtures/workbooks/template-structured.xlsx', import.meta.url));
    const sourceBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
    const templateBuffer = template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength) as ArrayBuffer;

    await dispatcher.dispatch({
      type: 'LIST_SOURCE_SHEETS',
      operationId: 'list-source-sheets',
      source: { name: 'source.xlsx', buffer: sourceBuffer },
    });
    await dispatcher.dispatch({
      type: 'INDEX_TEMPLATE',
      operationId: 'index-template',
      templateBuffer,
    });
    await dispatcher.dispatch({
      type: 'EXTRACT_DESTINATION',
      operationId: 'extract-destination',
      templateBuffer,
      sheetName: 'Dados Modelo',
      range: 'A2:D5',
    });

    expect(messages).toContainEqual(expect.objectContaining({
      type: 'RESULT',
      operationId: 'list-source-sheets',
        result: expect.objectContaining({ type: 'LIST_SOURCE_SHEETS', sheetNames: ['Dados', 'Ignorada'] }),
    }));
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'RESULT',
      operationId: 'index-template',
      result: expect.objectContaining({
        type: 'INDEX_TEMPLATE',
        index: expect.objectContaining({ sheets: expect.arrayContaining([expect.objectContaining({ name: 'Dados Modelo' })]) }),
      }),
    }));
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'RESULT',
      operationId: 'extract-destination',
      result: expect.objectContaining({
        type: 'EXTRACT_DESTINATION',
        dataset: expect.objectContaining({
          columns: expect.arrayContaining([expect.objectContaining({ header: 'ID' })]),
        }),
      }),
    }));
  });

  it('processes every global transform above the default batch size', async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => row(
      `r-${index}`,
      index + 2,
      { name__1: index % 10 === 0 ? null : index % 5 === 0 ? 'keep' : 1_001 - index },
    ));
    const cases = [
      {
        operationId: 'sort-global',
        command: { type: 'sort' as const, sorts: [{ columnId: 'name__1', direction: 'asc' as const }] },
        assertResult: (result: Dataset) => {
          expect(result.rows).toHaveLength(1_001);
          expect(result.rows.at(-1)?.values.name__1).toBeNull();
        },
      },
      {
        operationId: 'filter-global',
        command: { type: 'filter' as const, columnId: 'name__1', operator: 'equals' as const, value: 'keep' },
        assertResult: (result: Dataset) => expect(result.rows).toHaveLength(100),
      },
      {
        operationId: 'remove-empty-global',
        command: { type: 'removeEmptyRows' as const, columnIds: ['name__1'] },
        assertResult: (result: Dataset) => expect(result.rows).toHaveLength(900),
      },
      {
        operationId: 'deduplicate-global',
        command: { type: 'deduplicate' as const, columnIds: ['name__1'], keep: 'first' as const },
        assertResult: (result: Dataset) => expect(result.rows).toHaveLength(802),
      },
    ];

    for (const current of cases) {
      const messages: WorkerResponse[] = [];
      const dispatcher = createDataWorkerDispatcher((message) => messages.push(message));
      await dispatcher.dispatch({
        type: 'APPLY_TRANSFORMS',
        operationId: current.operationId,
        dataset: dataset(rows),
        commands: [current.command],
        batchSize: 1_000,
      });
      const response = messages.find((message): message is Extract<WorkerResponse, { type: 'RESULT' }> => (
        message.type === 'RESULT' && message.operationId === current.operationId
      ));
      expect(response?.result.type).toBe('APPLY_TRANSFORMS');
      if (response?.result.type === 'APPLY_TRANSFORMS') current.assertResult(response.result.dataset);
    }
  });

  it('cancels a global sort between worker batches', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => {
      messages.push(message);
      if (message.type === 'PROGRESS' && message.operationId === 'sort-cancel' && message.completed >= 100) {
        dispatcher.cancel('sort-cancel');
      }
    });
    const input = dataset(Array.from({ length: 1_001 }, (_, index) => row(
      `r-${index}`,
      index + 2,
      { name__1: 1_001 - index },
    )));

    await dispatcher.dispatch({
      type: 'APPLY_TRANSFORMS',
      operationId: 'sort-cancel',
      dataset: input,
      commands: [{ type: 'sort', sorts: [{ columnId: 'name__1', direction: 'asc' }] }],
      batchSize: 100,
    });

    expect(messages).toContainEqual({ type: 'CANCELLED', operationId: 'sort-cancel' });
    expect(messages.some((message) => message.type === 'RESULT' && message.operationId === 'sort-cancel')).toBe(false);
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

  it('observes cancellation while validating conditional uniqueness in row batches', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => {
      messages.push(message);
      if (message.type === 'PROGRESS' && message.operationId === 'conditional-unique-cancel' && message.phase === 'validate-unique' && message.completed === 1) {
        dispatcher.cancel('conditional-unique-cancel');
      }
    });
    const input = dataset(Array.from({ length: 5 }, (_, index) => row(
      `r-${index + 1}`,
      index + 2,
      { name__1: 'A', code__1: index % 2 === 0 ? 'Repeated' : `Code ${index}` },
    )));

    await dispatcher.dispatch({
      type: 'VALIDATE',
      operationId: 'conditional-unique-cancel',
      dataset: input,
      rules: [{
        type: 'conditionalMatrix',
        keyColumnIds: ['name__1'],
        dependentColumnIds: ['code__1'],
        entries: [{
          conditions: { name__1: { operator: 'equals', value: 'A' } },
          constraints: { code__1: { type: 'unique' } },
        }],
      }],
      batchSize: 1,
    });

    expect(messages).toContainEqual({ type: 'CANCELLED', operationId: 'conditional-unique-cancel' });
    expect(messages.some((message) => message.type === 'RESULT' && message.operationId === 'conditional-unique-cancel')).toBe(false);
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

  it('emits one large duplicate group in row-sized cancellable batches', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => {
      messages.push(message);
      if (message.type === 'PROGRESS' && message.operationId === 'unique-output-large' && message.phase === 'validate-unique-output' && message.completed === 1) {
        dispatcher.cancel('unique-output-large');
      }
    });
    const input = dataset(Array.from({ length: 5 }, (_, index) => row(
      `r-${index + 1}`,
      index + 2,
      { name__1: 'Repeated' },
    )));

    await dispatcher.dispatch({
      type: 'VALIDATE',
      operationId: 'unique-output-large',
      dataset: input,
      rules: [{ type: 'unique', columnId: 'name__1' }],
      batchSize: 1,
    });

    expect(messages).toContainEqual({
      type: 'PROGRESS', operationId: 'unique-output-large', completed: 1, total: 5, phase: 'validate-unique-output',
    });
    expect(messages).toContainEqual({ type: 'CANCELLED', operationId: 'unique-output-large' });
    expect(messages.some((message) => message.type === 'RESULT' && message.operationId === 'unique-output-large')).toBe(false);
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
        rejectedRows: [{
          sourceRowNumber: 9,
          originalRelevantFields: { source_id: 11 },
          errorField: 'source_id',
          invalidValue: 11,
          rejectionReason: 'invalid',
          failedRuleOrTransform: 'required',
        }],
        validationResult: { isValid: true, issues: [] },
      },
    });

    expect(messages).toContainEqual(expect.objectContaining({
      type: 'RESULT',
      operationId: 'export-small',
      result: expect.objectContaining({ type: 'EXPORT' }),
    }));
  });

  it('scans export risks after removing workbook and destination sheet protection', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => messages.push(message));
    const fixture = await readFile(new URL('../../../src/test-fixtures/workbooks/template-structured.xlsx', import.meta.url));
    const protectedPackage = await openOoxmlPackage(
      fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength) as ArrayBuffer,
    );
    protectedPackage.updatePart(
      'xl/workbook.xml',
      new TextDecoder().decode(protectedPackage.readPart('xl/workbook.xml')).replace(
        '<sheets>',
        '<workbookProtection lockStructure="1"/><sheets>',
      ),
    );
    protectedPackage.addPart('EncryptionInfo', new Uint8Array([1]));

    await dispatcher.dispatch({
      type: 'SCAN_EXPORT_RISKS',
      operationId: 'scan-sanitized-risks',
      templateBuffer: await protectedPackage.emit(),
      input: {
        destination: {
          sheetName: 'Protegida',
          range: 'A1:C4',
          dataStartRow: 2,
          templateRow: 4,
          columns: [
            { id: 'target_id', column: 'A' },
            { id: 'target_product', column: 'B' },
          ],
        },
        mappings: [
          { sourceColumnId: 'source_id', destinationColumnId: 'target_id', confidence: 'exact', score: 1, status: 'accepted' },
        ],
        writePlan: {
          mode: 'replace',
          headerRow: 1,
          clears: [],
          inserts: [{ incomingRowId: 'r-1', destinationRow: 2, values: { source_id: 1 } }],
          updates: [],
          kept: [],
          duplicates: [],
          rejected: [],
          assignments: [{ kind: 'insert', incomingRowId: 'r-1', destinationRow: 2 }],
        },
        validationResult: { isValid: true, issues: [] },
      },
    });

    const response = messages.find((message): message is Extract<WorkerResponse, { type: 'RESULT' }> => (
      message.type === 'RESULT' && message.operationId === 'scan-sanitized-risks'
    ));
    expect(response?.result).toMatchObject({
      type: 'EXPORT_RISKS',
      risks: expect.arrayContaining([
        expect.objectContaining({ code: 'unsupported-encrypted-package', severity: 'hard' }),
      ]),
    });
    if (response?.result.type === 'EXPORT_RISKS') {
      expect(response.result.risks.map((risk) => risk.code)).not.toEqual(expect.arrayContaining([
        'protected-workbook',
        'protected-destination-sheet',
      ]));
    }
  });

  it('processes export rows in cancellable batches and accounts for rejected rows', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => {
      messages.push(message);
      if (message.type === 'PROGRESS' && message.operationId === 'export-large' && message.phase === 'export' && message.completed === 1) {
        dispatcher.cancel('export-large');
      }
    });
    const fixture = await readFile(new URL('../../../src/test-fixtures/workbooks/template-structured.xlsx', import.meta.url));
    const templateBuffer = fixture.buffer.slice(
      fixture.byteOffset,
      fixture.byteOffset + fixture.byteLength,
    ) as ArrayBuffer;

    await dispatcher.dispatch({
      type: 'EXPORT',
      operationId: 'export-large',
      templateBuffer,
      batchSize: 1,
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
          inserts: [
            { incomingRowId: 'r-1', destinationRow: 3, values: { source_id: 1, source_product: 'Ana', source_quantity: 1, source_price: 1 } },
            { incomingRowId: 'r-2', destinationRow: 4, values: { source_id: 2, source_product: 'Bia', source_quantity: 2, source_price: 2 } },
          ],
          updates: [],
          kept: [],
          duplicates: [],
          rejected: [],
          assignments: [
            { kind: 'insert', incomingRowId: 'r-1', destinationRow: 3 },
            { kind: 'insert', incomingRowId: 'r-2', destinationRow: 4 },
          ],
        },
        rejectedRows: [{
          sourceRowNumber: 10,
          originalRelevantFields: { source_id: 3 },
          errorField: 'source_id',
          invalidValue: 3,
          rejectionReason: 'invalid',
          failedRuleOrTransform: 'required',
        }],
        validationResult: { isValid: true, issues: [] },
      },
    });

    expect(messages).toContainEqual({
      type: 'PROGRESS', operationId: 'export-large', completed: 1, total: 3, phase: 'export',
    });
    expect(messages).toContainEqual({ type: 'CANCELLED', operationId: 'export-large' });
    expect(messages.some((message) => message.type === 'RESULT' && message.operationId === 'export-large')).toBe(false);
  });

  it('processes incoming and existing plan rows in cancellable batches', async () => {
    const messages: WorkerResponse[] = [];
    const dispatcher = createDataWorkerDispatcher((message) => {
      messages.push(message);
      if (message.type === 'PROGRESS' && message.operationId === 'plan-large' && message.phase === 'plan' && message.completed === 1) {
        dispatcher.cancel('plan-large');
      }
    });
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
        existing: dataset([
          row('existing-1', 2, { name__1: 'Old Ana' }),
          row('existing-2', 3, { name__1: 'Old Bia' }),
          row('existing-3', 4, { name__1: 'Old Caio' }),
        ]),
        destination: { headerRow: 1, dataStartRow: 2 },
      },
    });

    expect(messages).toContainEqual({
      type: 'PROGRESS', operationId: 'plan-large', completed: 1, total: 5, phase: 'plan',
    });
    expect(messages).toContainEqual({ type: 'CANCELLED', operationId: 'plan-large' });
    expect(messages.some((message) => message.type === 'RESULT' && message.operationId === 'plan-large')).toBe(false);
  });
});
