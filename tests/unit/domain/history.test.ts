import { describe, expect, it } from 'vitest';
import type { Dataset } from '../../../src/domain/dataset/types';
import { TransformHistory } from '../../../src/domain/transforms/history';

const dataset: Dataset = {
  columns: [
    { id: 'name__1', header: 'Name', sourceIndex: 0, detectedType: 'string' },
    { id: 'amount__1', header: 'Amount', sourceIndex: 1, detectedType: 'number' },
  ],
  rows: [
    { rowId: 'r1', sourceRowNumber: 2, values: { name__1: 'Ana', amount__1: 10 }, originalValues: { name__1: 'Ana', amount__1: 10 } },
    { rowId: 'r2', sourceRowNumber: 3, values: { name__1: 'Bruno', amount__1: 2 }, originalValues: { name__1: 'Bruno', amount__1: 2 } },
  ],
};

describe('TransformHistory', () => {
  it('undoes and redoes a direct cell edit using its compact previous value', () => {
    const history = new TransformHistory(dataset);

    expect(history.execute({ type: 'editCell', rowId: 'r1', columnId: 'name__1', value: 'Beatriz' }).rows[0].values.name__1).toBe('Beatriz');
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.undo().rows[0].values.name__1).toBe('Ana');
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.redo().rows[0].values.name__1).toBe('Beatriz');
  });

  it('restores previous column order and discards redo after a new command', () => {
    const history = new TransformHistory(dataset);
    history.execute({ type: 'reorderColumns', columnIds: ['amount__1', 'name__1'] });

    expect(history.undo().columns.map((column) => column.id)).toEqual(['name__1', 'amount__1']);
    history.execute({ type: 'renameHeader', columnId: 'name__1', header: 'Cliente' });

    expect(history.canRedo).toBe(false);
    expect(history.current.columns[0].header).toBe('Cliente');
  });

  it('restores rows removed by a destructive command without changing provenance', () => {
    const history = new TransformHistory(dataset);
    history.execute({ type: 'filter', columnId: 'amount__1', operator: 'greaterThan', value: 5 });

    const result = history.undo();

    expect(result.rows.map((row) => row.rowId)).toEqual(['r1', 'r2']);
    expect(result.rows.map((row) => row.sourceRowNumber)).toEqual([2, 3]);
    expect(result.rows.map((row) => row.originalValues)).toEqual([
      { name__1: 'Ana', amount__1: 10 },
      { name__1: 'Bruno', amount__1: 2 },
    ]);
  });

  it('restores values and column metadata after a conversion', () => {
    const history = new TransformHistory(dataset);
    history.execute({ type: 'currencyConversion', columnId: 'amount__1', locale: 'en-US', currency: 'USD' });

    const result = history.undo();

    expect(result.columns.find((column) => column.id === 'amount__1')).toMatchObject({ detectedType: 'number' });
    expect(result.rows.map((row) => row.values.amount__1)).toEqual([10, 2]);
  });
});
