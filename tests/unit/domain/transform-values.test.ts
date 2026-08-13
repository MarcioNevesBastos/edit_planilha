import { describe, expect, it } from 'vitest';
import {
  detectDecimalSeparator,
  detectDateFormats,
  getDistinctColumnValues,
  getSuggestedDelimiters,
  parseCellValueInput,
} from '../../../src/domain/transforms/transform-values';
import type { Dataset } from '../../../src/domain/dataset/types';

const dataset: Dataset = {
  columns: [
    { id: 'value__1', header: 'Value', sourceIndex: 0, detectedType: 'number' },
    { id: 'flag__1', header: 'Flag', sourceIndex: 1, detectedType: 'boolean' },
  ],
  rows: [
    { rowId: '1', sourceRowNumber: 2, values: { value__1: 1, flag__1: true }, originalValues: {} },
    { rowId: '2', sourceRowNumber: 3, values: { value__1: 2, flag__1: false }, originalValues: {} },
    { rowId: '3', sourceRowNumber: 4, values: { value__1: '', flag__1: null }, originalValues: {} },
    { rowId: '4', sourceRowNumber: 5, values: { value__1: null, flag__1: null }, originalValues: {} },
    { rowId: '5', sourceRowNumber: 6, values: { value__1: 1, flag__1: true }, originalValues: {} },
  ],
};

describe('transform value helpers', () => {
  it('deduplicates typed values and merges null and empty text', () => {
    expect(getDistinctColumnValues(dataset, 'value__1')).toEqual([1, 2, null]);
  });

  it('limits suggestions to the first 500 distinct values', () => {
    const large: Dataset = {
      ...dataset,
      rows: Array.from({ length: 600 }, (_, index) => ({
        rowId: String(index),
        sourceRowNumber: index + 2,
        values: { value__1: index, flag__1: null },
        originalValues: {},
      })),
    };

    expect(getDistinctColumnValues(large, 'value__1')).toHaveLength(500);
    expect(getDistinctColumnValues(large, 'value__1').at(-1)).toBe(499);
  });

  it('parses free input according to the selected column type', () => {
    expect(parseCellValueInput('12,50', dataset.columns[0])).toBe(12.5);
    expect(parseCellValueInput('false', dataset.columns[1])).toBe(false);
  });

  it('rejects invalid typed input', () => {
    expect(() => parseCellValueInput('not-a-number', dataset.columns[0])).toThrow('Valor inválido');
    expect(() => parseCellValueInput('maybe', dataset.columns[1])).toThrow('Valor inválido');
  });

  it('detects recurring delimiters and date formats from column data', () => {
    const inferred: Dataset = {
      columns: [
        { id: 'text__1', header: 'Text', sourceIndex: 0, detectedType: 'string' },
        { id: 'date__1', header: 'Date', sourceIndex: 1, detectedType: 'date' },
      ],
      rows: [
        { rowId: '1', sourceRowNumber: 2, values: { text__1: 'Ana;Silva', date__1: '31/01/2026' }, originalValues: {} },
        { rowId: '2', sourceRowNumber: 3, values: { text__1: 'Bia;Souza', date__1: '2026-02-01' }, originalValues: {} },
      ],
    };

    expect(getSuggestedDelimiters(inferred, 'text__1')[0]).toBe(';');
    expect(detectDateFormats(inferred, 'date__1')).toEqual(['dd/MM/yyyy', 'yyyy-MM-dd']);
  });

  it('detects comma decimal notation from source values', () => {
    const localized: Dataset = {
      ...dataset,
      columns: [{ id: 'value__1', header: 'Value', sourceIndex: 0, detectedType: 'mixed' }, dataset.columns[1]],
      rows: [{ rowId: '1', sourceRowNumber: 2, values: { value__1: '12,50', flag__1: null }, originalValues: {} }],
    };

    expect(detectDecimalSeparator(localized, 'value__1')).toBe(',');
  });
});
