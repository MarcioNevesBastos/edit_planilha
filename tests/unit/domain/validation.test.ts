import { describe, expect, it } from 'vitest';
import { validateDataset, validateRow } from '../../../src/domain/validation/validate-row';
import type { Dataset, DataRow } from '../../../src/domain/dataset/types';
import type { ValidationRule } from '../../../src/domain/validation/types';

function row(rowId: string, sourceRowNumber: number, values: DataRow['values']): DataRow {
  return { rowId, sourceRowNumber, values, originalValues: { ...values } };
}

describe('validateRow', () => {
  it('reports every local rule violation with cell provenance without mutating values', () => {
    const input = row('r-2', 7, {
      required__1: ' ',
      count__1: 'two',
      status__1: 'archived',
      minimum__1: 4,
      maximum__1: 12,
      date_min__1: '2025-12-31',
      date_max__1: '2027-01-01',
      short__1: 'a',
      long__1: 'abcd',
    });
    const rules: ValidationRule[] = [
      { type: 'required', columnId: 'required__1' },
      { type: 'type', columnId: 'count__1', valueType: 'number' },
      { type: 'allowed', columnId: 'status__1', allowedValues: ['active', 'inactive'] },
      { type: 'numberRange', columnId: 'minimum__1', min: 5 },
      { type: 'numberRange', columnId: 'maximum__1', max: 10 },
      { type: 'dateRange', columnId: 'date_min__1', min: '2026-01-01' },
      { type: 'dateRange', columnId: 'date_max__1', max: '2026-12-31' },
      { type: 'stringLength', columnId: 'short__1', min: 2 },
      { type: 'stringLength', columnId: 'long__1', max: 3 },
    ];

    const issues = validateRow(input, rules);

    expect(issues.map((issue) => issue.code)).toEqual([
      'required', 'type', 'allowed', 'min', 'max', 'date_min', 'date_max', 'min_length', 'max_length',
    ]);
    expect(issues[0]).toMatchObject({
      rowId: 'r-2',
      sourceRowNumber: 7,
      columnId: 'required__1',
      value: ' ',
    });
    expect(input.values).toEqual({
      required__1: ' ',
      count__1: 'two',
      status__1: 'archived',
      minimum__1: 4,
      maximum__1: 12,
      date_min__1: '2025-12-31',
      date_max__1: '2027-01-01',
      short__1: 'a',
      long__1: 'abcd',
    });
  });
});

describe('validateDataset', () => {
  it('reports each duplicated single and composite key without changing dataset rows', () => {
    const dataset: Dataset = {
      columns: [],
      rows: [
        row('r-1', 2, { email__1: 'ana@example.com', office__1: 'SP', code__1: 'A' }),
        row('r-2', 3, { email__1: 'ana@example.com', office__1: 'SP', code__1: 'A' }),
        row('r-3', 4, { email__1: 'bruno@example.com', office__1: 'SP', code__1: 'B' }),
      ],
    };
    const rules: ValidationRule[] = [
      { type: 'unique', columnId: 'email__1' },
      { type: 'compositeUnique', columnIds: ['office__1', 'code__1'] },
    ];

    const result = validateDataset(dataset, rules);

    expect(result.isValid).toBe(false);
    expect(result.issues.map((issue) => [issue.rowId, issue.columnId, issue.code])).toEqual([
      ['r-1', 'email__1', 'unique'],
      ['r-2', 'email__1', 'unique'],
      ['r-1', 'office__1', 'composite_unique'],
      ['r-2', 'office__1', 'composite_unique'],
    ]);
    expect(dataset.rows.map((currentRow) => currentRow.values)).toEqual([
      { email__1: 'ana@example.com', office__1: 'SP', code__1: 'A' },
      { email__1: 'ana@example.com', office__1: 'SP', code__1: 'A' },
      { email__1: 'bruno@example.com', office__1: 'SP', code__1: 'B' },
    ]);
  });
});
