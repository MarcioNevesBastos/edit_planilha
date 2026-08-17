import { describe, expect, it } from 'vitest';
import type { DataRow, Dataset } from '../../../src/domain/dataset/types';
import { initialOperationTotal } from '../../../src/app/operation-progress';

function datasetWithRows(count: number): Dataset {
  const rows: DataRow[] = Array.from({ length: count }, (_, index) => ({
    rowId: `row-${index + 1}`,
    sourceRowNumber: index + 2,
    values: {},
    originalValues: {},
  }));
  return { columns: [], rows };
}

describe('initialOperationTotal', () => {
  it('uses incoming rows for transforms and validation', () => {
    const dataset = datasetWithRows(10);
    const transformRequest = {
      type: 'APPLY_TRANSFORMS' as const,
      operationId: 'transform-1',
      dataset,
      commands: [],
    };

    expect(initialOperationTotal(transformRequest)).toBe(10);
    expect(initialOperationTotal({
      type: 'VALIDATE',
      operationId: 'validate-1',
      dataset,
      rules: [],
    })).toBe(10);
  });

  it('returns zero when the operation has no row-based estimate', () => {
    expect(initialOperationTotal({
      type: 'INDEX_TEMPLATE',
      operationId: 'index-1',
      templateBuffer: new ArrayBuffer(0),
    })).toBe(0);

    expect(initialOperationTotal({
      type: 'PLAN_WRITE',
      operationId: 'plan-1',
      input: {
        mode: 'replace',
        incoming: datasetWithRows(4),
        existing: datasetWithRows(2),
        destination: { headerRow: 1, dataStartRow: 2 },
      },
    })).toBe(4);
  });
});
