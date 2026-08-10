import { describe, expect, it } from 'vitest';
import { applyTransform } from '../../../src/domain/transforms/apply-transform';
import type { Dataset } from '../../../src/domain/dataset/types';
import type { TransformCommand } from '../../../src/domain/transforms/types';

const dataset: Dataset = {
  columns: [
    { id: 'name__1', header: 'Name', sourceIndex: 0, detectedType: 'string' },
    { id: 'city__1', header: 'City', sourceIndex: 1, detectedType: 'string' },
    { id: 'amount__1', header: 'Amount', sourceIndex: 2, detectedType: 'number' },
    { id: 'date__1', header: 'Date', sourceIndex: 3, detectedType: 'date' },
  ],
  rows: [
    {
      rowId: 'r1',
      sourceRowNumber: 2,
      values: { name__1: 'Ana Silva', city__1: 'Sao Paulo', amount__1: 10, date__1: '31/01/2026' },
      originalValues: { name__1: 'Ana Silva', city__1: 'Sao Paulo', amount__1: 10, date__1: '31/01/2026' },
    },
    {
      rowId: 'r2',
      sourceRowNumber: 3,
      values: { name__1: 'Bruno', city__1: 'Rio', amount__1: 2, date__1: '2026-02-01' },
      originalValues: { name__1: 'Bruno', city__1: 'Rio', amount__1: 2, date__1: '2026-02-01' },
    },
    {
      rowId: 'r3',
      sourceRowNumber: 4,
      values: { name__1: 'Ana Silva', city__1: '', amount__1: null, date__1: null },
      originalValues: { name__1: 'Ana Silva', city__1: '', amount__1: null, date__1: null },
    },
  ],
};

function expectSourceMetadata(result: Dataset): void {
  for (const row of result.rows) {
    const source = dataset.rows.find((candidate) => candidate.rowId === row.rowId);
    expect(row.sourceRowNumber).toBe(source?.sourceRowNumber);
    expect(row.originalValues).toEqual(source?.originalValues);
  }
}

describe('applyTransform', () => {
  const cases: Array<{
    name: string;
    command: TransformCommand;
    assert: (result: Dataset) => void;
  }> = [
    {
      name: 'reorders columns by explicit column ids',
      command: { type: 'reorderColumns', columnIds: ['amount__1', 'name__1', 'city__1', 'date__1'] },
      assert: (result) => expect(result.columns.map((column) => column.id)).toEqual(['amount__1', 'name__1', 'city__1', 'date__1']),
    },
    {
      name: 'sorts by multiple columns without changing row provenance',
      command: { type: 'sort', sorts: [{ columnId: 'name__1', direction: 'asc' }, { columnId: 'amount__1', direction: 'desc' }] },
      assert: (result) => expect(result.rows.map((row) => row.rowId)).toEqual(['r1', 'r3', 'r2']),
    },
    {
      name: 'filters rows with a textual operator',
      command: { type: 'filter', columnId: 'city__1', operator: 'contains', value: 'Rio' },
      assert: (result) => expect(result.rows.map((row) => row.rowId)).toEqual(['r2']),
    },
    {
      name: 'removes rows empty in selected columns',
      command: { type: 'removeEmptyRows', columnIds: ['amount__1', 'date__1'] },
      assert: (result) => expect(result.rows.map((row) => row.rowId)).toEqual(['r1', 'r2']),
    },
    {
      name: 'deduplicates selected keys while keeping first row',
      command: { type: 'deduplicate', columnIds: ['name__1'], keep: 'first' },
      assert: (result) => expect(result.rows.map((row) => row.rowId)).toEqual(['r1', 'r2']),
    },
    {
      name: 'renames a header without changing its stable id',
      command: { type: 'renameHeader', columnId: 'city__1', header: 'Municipio' },
      assert: (result) => expect(result.columns.find((column) => column.id === 'city__1')).toMatchObject({ id: 'city__1', header: 'Municipio' }),
    },
    {
      name: 'splits a column into explicitly identified columns',
      command: { type: 'splitColumn', columnId: 'name__1', delimiter: ' ', newColumns: [{ id: 'first__1', header: 'First' }, { id: 'last__1', header: 'Last' }] },
      assert: (result) => {
        expect(result.rows.map((row) => [row.values.first__1, row.values.last__1])).toEqual([['Ana', 'Silva'], ['Bruno', null], ['Ana', 'Silva']]);
        expect(result.columns.map((column) => column.id)).toEqual(['name__1', 'first__1', 'last__1', 'city__1', 'amount__1', 'date__1']);
      },
    },
    {
      name: 'combines columns into an explicitly identified column',
      command: { type: 'combineColumns', columnIds: ['name__1', 'city__1'], separator: ' - ', newColumn: { id: 'label__1', header: 'Label' } },
      assert: (result) => expect(result.rows.map((row) => row.values.label__1)).toEqual(['Ana Silva - Sao Paulo', 'Bruno - Rio', 'Ana Silva']),
    },
    {
      name: 'finds and replaces literal text',
      command: { type: 'findReplace', columnIds: ['city__1'], find: 'Sao', replace: 'São', caseSensitive: true },
      assert: (result) => expect(result.rows.map((row) => row.values.city__1)).toEqual(['São Paulo', 'Rio', '']),
    },
    {
      name: 'converts dates to the requested format',
      command: { type: 'dateConversion', columnId: 'date__1', inputFormat: 'auto', outputFormat: 'yyyy-MM-dd' },
      assert: (result) => expect(result.rows.map((row) => row.values.date__1)).toEqual(['2026-01-31', '2026-02-01', null]),
    },
    {
      name: 'converts numeric cells',
      command: { type: 'numberConversion', columnId: 'amount__1', decimalSeparator: ',' },
      assert: (result) => expect(result.rows.map((row) => row.values.amount__1)).toEqual([10, 2, null]),
    },
    {
      name: 'converts numbers to currency strings',
      command: { type: 'currencyConversion', columnId: 'amount__1', locale: 'en-US', currency: 'USD' },
      assert: (result) => expect(result.rows.map((row) => row.values.amount__1)).toEqual(['$10.00', '$2.00', null]),
    },
    {
      name: 'adds a prefix to nonempty values',
      command: { type: 'prefix', columnId: 'name__1', value: 'Dr. ' },
      assert: (result) => expect(result.rows.map((row) => row.values.name__1)).toEqual(['Dr. Ana Silva', 'Dr. Bruno', 'Dr. Ana Silva']),
    },
    {
      name: 'adds a suffix to nonempty values',
      command: { type: 'suffix', columnId: 'name__1', value: '!' },
      assert: (result) => expect(result.rows.map((row) => row.values.name__1)).toEqual(['Ana Silva!', 'Bruno!', 'Ana Silva!']),
    },
    {
      name: 'sets a fixed value',
      command: { type: 'fixedValue', columnId: 'city__1', value: 'Brasil' },
      assert: (result) => expect(result.rows.map((row) => row.values.city__1)).toEqual(['Brasil', 'Brasil', 'Brasil']),
    },
    {
      name: 'creates a calculated column from a constrained expression ast',
      command: { type: 'calculatedColumn', newColumn: { id: 'double__1', header: 'Double' }, expression: { type: 'binary', operator: '*', left: { type: 'column', columnId: 'amount__1' }, right: { type: 'literal', value: 2 } } },
      assert: (result) => expect(result.rows.map((row) => row.values.double__1)).toEqual([20, 4, null]),
    },
    {
      name: 'applies updates only when a constrained condition matches',
      command: { type: 'conditionalRule', condition: { type: 'binary', operator: '>', left: { type: 'column', columnId: 'amount__1' }, right: { type: 'literal', value: 5 } }, updates: [{ columnId: 'city__1', value: 'Maior' }] },
      assert: (result) => expect(result.rows.map((row) => row.values.city__1)).toEqual(['Maior', 'Rio', '']),
    },
    {
      name: 'edits one cell directly',
      command: { type: 'editCell', rowId: 'r2', columnId: 'name__1', value: 'Beatriz' },
      assert: (result) => expect(result.rows.map((row) => row.values.name__1)).toEqual(['Ana Silva', 'Beatriz', 'Ana Silva']),
    },
  ];

  it.each(cases)('$name without mutating the input or losing provenance', ({ command, assert }) => {
    const input = structuredClone(dataset);
    const result = applyTransform(input, command);

    assert(result);
    expect(input).toEqual(dataset);
    expect(result).not.toBe(input);
    expectSourceMetadata(result);
  });

  it('does not treat empty cells as values in threshold filters', () => {
    const result = applyTransform(dataset, {
      type: 'filter',
      columnId: 'amount__1',
      operator: 'lessThan',
      value: 5,
    });

    expect(result.rows.map((row) => row.rowId)).toEqual(['r2']);
  });
});
