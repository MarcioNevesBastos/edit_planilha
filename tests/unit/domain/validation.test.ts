import { describe, expect, it } from 'vitest';
import { validateDataset, validateRow } from '../../../src/domain/validation/validate-row';
import { distinctMatrixEntries, validateConditionalMatrixRule } from '../../../src/domain/validation/matrix';
import { analyzeValidationRules, validateRuleConfiguration } from '../../../src/domain/validation/rule-analysis';
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
    expect(issues.map((issue) => issue.message)).toEqual([
      'O preenchimento de um valor é obrigatório.',
      'É esperado um valor do tipo número.',
      'O valor não está na lista permitida.',
      'O valor deve ser no mínimo 5.',
      'O valor deve ser no máximo 10.',
      'A data deve ser igual ou posterior a 2026-01-01.',
      'A data deve ser igual ou anterior a 2026-12-31.',
      'O texto deve conter pelo menos 2 caracteres.',
      'O texto deve conter no máximo 3 caracteres.',
    ]);
  });

  it('validates presence, numeric precision, blocked values, and safe formats', () => {
    const input = row('r-3', 8, {
      should_be_empty__1: 'filled',
      whole_number__1: 1.5,
      precise_number__1: 12.345,
      blocked__1: 'blocked',
      email__1: 'invalid-email',
      code__1: 'USR-42',
    });
    const rules: ValidationRule[] = [
      { type: 'empty', columnId: 'should_be_empty__1' },
      { type: 'integer', columnId: 'whole_number__1' },
      { type: 'numberPrecision', columnId: 'precise_number__1', decimalPlaces: 2 },
      { type: 'notAllowed', columnId: 'blocked__1', disallowedValues: ['blocked'] },
      { type: 'format', columnId: 'email__1', format: 'email' },
      { type: 'format', columnId: 'code__1', format: 'regex', pattern: '^ID-\\d+$' },
    ];

    const issues = validateRow(input, rules);

    expect(issues.map((issue) => issue.code)).toEqual([
      'empty', 'integer', 'number_precision', 'not_allowed', 'format', 'format',
    ]);
  });

  it('accepts configured format presets and ignores empty optional values', () => {
    const input = row('r-4', 9, {
      cpf__1: '529.982.247-25',
      cnpj__1: '04.252.011/0001-10',
      cep__1: '01310-100',
      phone__1: '(11) 99999-9999',
      prefix__1: 'CLI-0042',
      suffix__1: '0042-BR',
      optional__1: null,
    });
    const rules: ValidationRule[] = [
      { type: 'format', columnId: 'cpf__1', format: 'cpf' },
      { type: 'format', columnId: 'cnpj__1', format: 'cnpj' },
      { type: 'format', columnId: 'cep__1', format: 'cep' },
      { type: 'format', columnId: 'phone__1', format: 'phone' },
      { type: 'format', columnId: 'prefix__1', format: 'prefix', prefix: 'CLI-' },
      { type: 'format', columnId: 'suffix__1', format: 'suffix', suffix: '-BR' },
      { type: 'format', columnId: 'optional__1', format: 'email' },
    ];

    expect(validateRow(input, rules)).toEqual([]);
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
      'As linhas 1 e 2 da matriz entram em conflito para as mesmas condições.',
    ]);
    expect(validateConditionalMatrixRule({ ...rule, dependentColumnIds: ['missing__1'] }, ['context__1', 'value__1'])).toContain(
      'A coluna dependente da matriz não existe: missing__1.',
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

  it('validates same-row comparisons, safe expressions, and custom rule metadata', () => {
    const dataset: Dataset = {
      columns: [],
      rows: [
        row('r-1', 2, { start__1: 10, end__1: 4, total__1: 14 }),
        row('r-2', 3, { start__1: 2, end__1: 4, total__1: 6 }),
      ],
    };
    const rules: ValidationRule[] = [
      {
        type: 'comparison',
        id: 'range-order',
        name: 'Início antes do fim',
        left: { type: 'column', columnId: 'start__1' },
        operator: 'lessThanOrEqual',
        right: { type: 'column', columnId: 'end__1' },
      },
      {
        type: 'expression',
        id: 'total-check',
        expression: {
          type: 'binary',
          operator: '==',
          left: {
            type: 'binary',
            operator: '+',
            left: { type: 'column', columnId: 'start__1' },
            right: { type: 'column', columnId: 'end__1' },
          },
          right: { type: 'column', columnId: 'total__1' },
        },
      },
    ];

    const result = validateDataset(dataset, rules);

    expect(result.issues.map(({ rowId, ruleId, code }) => [rowId, ruleId, code])).toEqual([
      ['r-1', 'range-order', 'comparison'],
    ]);
    expect(result.ruleImpact).toEqual({
      'range-order': { affectedRows: 1, affectedCells: 1 },
      'total-check': { affectedRows: 0, affectedCells: 0 },
    });
  });

  it('validates references and blocks invalid configurations before execution', () => {
    const dataset: Dataset = {
      columns: [],
      rows: [
        row('r-1', 2, { code__1: 'A', reference__1: 'A' }),
        row('r-2', 3, { code__1: 'B', reference__1: 'C' }),
      ],
    };
    const rule: ValidationRule = {
      type: 'reference',
      id: 'known-code',
      columnId: 'reference__1',
      referenceColumnId: 'code__1',
      mode: 'exists',
    };

    const result = validateDataset(dataset, [rule]);

    expect(result.issues).toEqual([expect.objectContaining({
      rowId: 'r-2',
      ruleId: 'known-code',
      code: 'reference',
    })]);
    expect(validateRuleConfiguration({ type: 'numberRange', columnId: 'missing__1', min: 5, max: 2 }, ['value__1'])).toEqual([
      'A coluna da regra não existe: missing__1.',
      'O limite mínimo não pode ser maior que o máximo.',
    ]);
  });

  it('validates composite relationships with exact cardinality from an external dataset', () => {
    const dataset: Dataset = {
      columns: [
        { id: 'office__1', header: 'Office', sourceIndex: 0, detectedType: 'string' },
        { id: 'code__1', header: 'Code', sourceIndex: 1, detectedType: 'string' },
      ],
      rows: [
        row('incoming-1', 2, { office__1: 'SP', code__1: 'A' }),
        row('incoming-2', 3, { office__1: 'RJ', code__1: 'B' }),
      ],
    };
    const catalog: Dataset = {
      columns: [
        { id: 'catalog_office__1', header: 'Office', sourceIndex: 0, detectedType: 'string' },
        { id: 'catalog_code__1', header: 'Code', sourceIndex: 1, detectedType: 'string' },
      ],
      rows: [
        row('catalog-1', 2, { catalog_office__1: 'SP', catalog_code__1: 'A' }),
        row('catalog-2', 3, { catalog_office__1: 'SP', catalog_code__1: 'A' }),
      ],
    };
    const rule: ValidationRule = {
      type: 'relation',
      source: 'catalog',
      leftColumnIds: ['office__1', 'code__1'],
      rightColumnIds: ['catalog_office__1', 'catalog_code__1'],
      minMatches: 1,
      maxMatches: 1,
    };

    const result = validateDataset(dataset, [rule], { catalog });

    expect(result.issues.map(({ rowId, code }) => [rowId, code])).toEqual([
      ['incoming-1', 'relation'],
      ['incoming-2', 'relation'],
    ]);
  });

  it('supports zero, at-most-one, at-least-one, and at-least-two cardinalities', () => {
    const dataset: Dataset = {
      columns: [{ id: 'code__1', header: 'Code', sourceIndex: 0, detectedType: 'string' }],
      rows: [row('one', 2, { code__1: 'A' }), row('many', 3, { code__1: 'B' }), row('none', 4, { code__1: 'C' })],
    };
    const catalog: Dataset = {
      columns: [{ id: 'catalog_code__1', header: 'Code', sourceIndex: 0, detectedType: 'string' }],
      rows: [row('catalog-a', 2, { catalog_code__1: 'A' }), row('catalog-b1', 3, { catalog_code__1: 'B' }), row('catalog-b2', 4, { catalog_code__1: 'B' })],
    };
    const relation = (id: string, minMatches: number, maxMatches?: number): ValidationRule => ({ type: 'relation', id, source: 'catalog', leftColumnIds: ['code__1'], rightColumnIds: ['catalog_code__1'], minMatches, maxMatches });

    const result = validateDataset(dataset, [
      relation('none', 0, 0),
      relation('at-most-one', 0, 1),
      relation('at-least-one', 1),
      relation('at-least-two', 2),
    ], { catalog });

    expect(result.issues.filter(({ ruleId }) => ruleId === 'none').map(({ rowId }) => rowId)).toEqual(['one', 'many']);
    expect(result.issues.filter(({ ruleId }) => ruleId === 'at-most-one').map(({ rowId }) => rowId)).toEqual(['many']);
    expect(result.issues.filter(({ ruleId }) => ruleId === 'at-least-one').map(({ rowId }) => rowId)).toEqual(['none']);
    expect(result.issues.filter(({ ruleId }) => ruleId === 'at-least-two').map(({ rowId }) => rowId)).toEqual(['one', 'none']);
  });

  it('rejects invalid relationship cardinality and unavailable sources before execution', () => {
    const rule: ValidationRule = {
      type: 'relation',
      source: 'missing-catalog',
      leftColumnIds: ['value__1'],
      rightColumnIds: ['catalog_value__1'],
      minMatches: 2,
      maxMatches: 1,
    };

    expect(validateRuleConfiguration(rule, ['value__1'])).toContain('A cardinalidade mínima não pode ser maior que a máxima.');
    expect(validateDataset({ columns: [], rows: [] }, [rule]).configurationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'A fonte de relacionamento não está disponível: missing-catalog.' }),
    ]));
  });

  it('blocks invalid precision and custom format configuration', () => {
    expect(validateRuleConfiguration({ type: 'numberPrecision', columnId: 'value__1', decimalPlaces: -1 }, ['value__1'])).toEqual([
      'A precisão decimal deve ser um inteiro não negativo.',
    ]);
    expect(validateRuleConfiguration({ type: 'format', columnId: 'value__1', format: 'regex', pattern: '[' }, ['value__1'])).toEqual([
      'O padrão informado não é uma expressão regular válida.',
    ]);
    expect(validateRuleConfiguration({ type: 'format', columnId: 'value__1', format: 'prefix' }, ['value__1'])).toEqual([
      'O prefixo da regra de formato não pode estar vazio.',
    ]);
  });

  it('detects duplicated and contradictory rules before scanning rows', () => {
    const errors = analyzeValidationRules([
      { type: 'required', id: 'required-a', columnId: 'value__1' },
      { type: 'required', id: 'required-b', columnId: 'value__1' },
      { type: 'numberRange', id: 'range-a', columnId: 'value__1', max: 2 },
      { type: 'numberRange', id: 'range-b', columnId: 'value__1', min: 5 },
    ], ['value__1']);

    expect(errors.map(({ message }) => message)).toEqual([
      'As regras required-a e required-b são duplicadas.',
      'As regras range-a e range-b não possuem valores em comum.',
    ]);
  });
});
