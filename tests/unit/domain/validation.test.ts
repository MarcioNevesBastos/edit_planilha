import { describe, expect, it } from 'vitest';
import { validateDataset, validateRow } from '../../../src/domain/validation/validate-row';
import { distinctMatrixEntries, validateConditionalMatrixRule } from '../../../src/domain/validation/matrix';
import type { Dataset, DataRow } from '../../../src/domain/dataset/types';
import type { ConditionalMatrixRule, ValidationRule } from '../../../src/domain/validation/types';

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
  it('reports a conditional required warning when a matching context is incomplete', () => {
    const dataset: Dataset = {
      columns: [],
      rows: [
        row('r-1', 2, { tipo__1: 'PJ', cnpj__1: null }),
        row('r-2', 3, { tipo__1: 'PF', cnpj__1: null }),
      ],
    };
    const rule = {
      type: 'conditionalMatrix',
      keyColumnIds: ['tipo__1'],
      dependentColumnIds: ['cnpj__1'],
      entries: [{
        conditions: { tipo__1: { operator: 'equals', value: 'PJ' } },
        constraints: { cnpj__1: { type: 'required' } },
      }],
    } as unknown as ValidationRule;

    const result = validateDataset(dataset, [rule]);

    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(2);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({
      rowId: 'r-1',
      columnId: 'cnpj__1',
      code: 'conditional_required',
      severity: 'warning',
    })]));
  });

  it('supports conditional equality, emptiness, allowed values, types, ranges, and lengths', () => {
    const dataset: Dataset = {
      columns: [],
      rows: [row('r-1', 2, {
        context__1: 'A',
        equals__1: 'wrong',
        empty__1: 'filled',
        allowed__1: 'other',
        typed__1: 'not-number',
        number__1: 2,
        date__1: '2025-01-01',
        text__1: 'a',
      })],
    };
    const rule = {
      type: 'conditionalMatrix',
      keyColumnIds: ['context__1'],
      dependentColumnIds: ['equals__1', 'empty__1', 'allowed__1', 'typed__1', 'number__1', 'date__1', 'text__1'],
      entries: [{
        conditions: { context__1: { operator: 'equals', value: 'A' } },
        constraints: {
          equals__1: { type: 'equals', value: 'expected' },
          empty__1: { type: 'empty' },
          allowed__1: { type: 'allowed', allowedValues: ['one', 'two'] },
          typed__1: { type: 'type', valueType: 'number' },
          number__1: { type: 'numberRange', min: 5 },
          date__1: { type: 'dateRange', min: '2026-01-01' },
          text__1: { type: 'stringLength', min: 2 },
        },
      }],
    } as unknown as ValidationRule;

    const result = validateDataset(dataset, [rule]);

    expect(result.isValid).toBe(true);
    expect(result.issues.map(({ code }) => code)).toEqual([
      'conditional_equals',
      'conditional_empty',
      'conditional_allowed',
      'conditional_type',
      'conditional_min',
      'conditional_date_min',
      'conditional_min_length',
    ]);
  });

  it('applies conditional uniqueness only inside the matching context', () => {
    const dataset: Dataset = {
      columns: [],
      rows: [
        row('a-1', 2, { context__1: 'A', code__1: 'X' }),
        row('a-2', 3, { context__1: 'A', code__1: 'X' }),
        row('b-1', 4, { context__1: 'B', code__1: 'X' }),
        row('b-2', 5, { context__1: 'B', code__1: 'Y' }),
      ],
    };
    const rule = {
      type: 'conditionalMatrix',
      keyColumnIds: ['context__1'],
      dependentColumnIds: ['code__1'],
      entries: [
        {
          conditions: { context__1: { operator: 'equals', value: 'A' } },
          constraints: { code__1: { type: 'unique' } },
        },
        {
          conditions: { context__1: { operator: 'equals', value: 'B' } },
          constraints: { code__1: { type: 'any' } },
        },
      ],
    } as unknown as ValidationRule;

    const result = validateDataset(dataset, [rule]);

    expect(result.issues.filter(({ code }) => code === 'conditional_unique').map(({ rowId }) => rowId)).toEqual(['a-1', 'a-2']);
  });

  it('applies conditional composite uniqueness inside the matching context', () => {
    const dataset: Dataset = {
      columns: [],
      rows: [
        row('a-1', 2, { context__1: 'A', office__1: 'SP', code__1: 'X' }),
        row('a-2', 3, { context__1: 'A', office__1: 'SP', code__1: 'X' }),
        row('b-1', 4, { context__1: 'B', office__1: 'SP', code__1: 'X' }),
        row('b-2', 5, { context__1: 'B', office__1: 'SP', code__1: 'X' }),
      ],
    };
    const rule = {
      type: 'conditionalMatrix',
      keyColumnIds: ['context__1'],
      dependentColumnIds: ['office__1', 'code__1'],
      entries: [
        {
          conditions: { context__1: { operator: 'equals', value: 'A' } },
          constraints: { code__1: { type: 'compositeUnique', columnIds: ['office__1', 'code__1'] } },
        },
        {
          conditions: { context__1: { operator: 'equals', value: 'B' } },
          constraints: { code__1: { type: 'any' } },
        },
      ],
    } as unknown as ValidationRule;

    const result = validateDataset(dataset, [rule]);

    expect(result.issues.filter(({ code }) => code === 'conditional_composite_unique').map(({ rowId }) => rowId)).toEqual(['a-1', 'a-2']);
  });

  it('imports distinct rows as exact matrix entries with explicit empty states', () => {
    const dataset: Dataset = {
      columns: [],
      rows: [
        row('r-1', 2, { context__1: 'A', value__1: 'X' }),
        row('r-2', 3, { context__1: 'A', value__1: 'X' }),
        row('r-3', 4, { context__1: 'B', value__1: null }),
      ],
    };

    const entries = distinctMatrixEntries(dataset, ['context__1'], ['value__1']);

    expect(entries).toEqual([
      {
        conditions: { context__1: { operator: 'equals', value: 'A' } },
        constraints: { value__1: { type: 'equals', value: 'X' } },
      },
      {
        conditions: { context__1: { operator: 'equals', value: 'B' } },
        constraints: { value__1: { type: 'empty' } },
      },
    ]);
  });

  it('rejects matrix columns and conflicting entries before execution', () => {
    const rule: ConditionalMatrixRule = {
      type: 'conditionalMatrix',
      keyColumnIds: ['context__1'],
      dependentColumnIds: ['value__1'],
      entries: [
        {
          conditions: { context__1: { operator: 'equals', value: 'A' } },
          constraints: { value__1: { type: 'equals', value: 'X' } },
        },
        {
          conditions: { context__1: { operator: 'equals', value: 'A' } },
          constraints: { value__1: { type: 'equals', value: 'Y' } },
        },
      ],
    };

    expect(validateConditionalMatrixRule(rule, ['context__1', 'value__1'])).toEqual([
      'Matrix entries 1 and 2 conflict for the same conditions.',
    ]);
    expect(validateConditionalMatrixRule({ ...rule, dependentColumnIds: ['missing__1'] }, ['context__1', 'value__1'])).toContain(
      'Matrix dependent column is not present: missing__1.',
    );
  });

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
