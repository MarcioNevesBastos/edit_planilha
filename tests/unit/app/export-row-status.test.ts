import { describe, expect, it } from 'vitest';
import { getExportRowCounts, getValidationErrorRowIds } from '../../../src/app/export-row-status';
import type { Dataset } from '../../../src/domain/dataset/types';
import type { WritePlan } from '../../../src/domain/merge/types';

const dataset: Dataset = {
  columns: [{ id: 'status__1', header: 'Status', sourceIndex: 0, detectedType: 'string' }],
  rows: [
    { rowId: 'r-1', sourceRowNumber: 2, values: { status__1: 'ok' }, originalValues: { status__1: 'ok' } },
    { rowId: 'r-2', sourceRowNumber: 3, values: { status__1: 'warn' }, originalValues: { status__1: 'warn' } },
    { rowId: 'r-3', sourceRowNumber: 4, values: { status__1: 'bad' }, originalValues: { status__1: 'bad' } },
    { rowId: 'r-4', sourceRowNumber: 5, values: { status__1: 'duplicate' }, originalValues: { status__1: 'duplicate' } },
  ],
};

const emptyPlan = (overrides: Partial<WritePlan> = {}): WritePlan => ({
  mode: 'append',
  headerRow: 1,
  clears: [],
  inserts: [],
  updates: [],
  kept: [],
  duplicates: [],
  rejected: [],
  assignments: [],
  ...overrides,
});

describe('export row status', () => {
  it('deduplicates validation errors by row and excludes warnings', () => {
    expect(getValidationErrorRowIds([
      { rowId: 'r-3', sourceRowNumber: 4, columnId: 'status__1', code: 'required', value: null, message: 'Obrigatório' },
      { rowId: 'r-3', sourceRowNumber: 4, columnId: 'status__1', code: 'type', value: null, message: 'Tipo' },
      { rowId: 'r-2', sourceRowNumber: 3, columnId: 'status__1', code: 'warning', value: 'warn', message: 'Aviso', severity: 'warning' },
    ])).toEqual(new Set(['r-3']));
  });

  it('counts preview rows as valid when they only contain warnings', () => {
    const counts = getExportRowCounts(dataset, [
      { rowId: 'r-3', sourceRowNumber: 4, columnId: 'status__1', code: 'required', value: null, message: 'Obrigatório' },
      { rowId: 'r-2', sourceRowNumber: 3, columnId: 'status__1', code: 'warning', value: 'warn', message: 'Aviso', severity: 'warning' },
    ]);

    expect(counts).toMatchObject({ totalRows: 4, validationErrorRows: 1, planRejectedRows: 0, rejectedRows: 1, exportableRows: 3 });
  });

  it('unites validation errors and plan rejections without double-counting rows', () => {
    const counts = getExportRowCounts(dataset, [
      { rowId: 'r-3', sourceRowNumber: 4, columnId: 'status__1', code: 'required', value: null, message: 'Obrigatório' },
    ], emptyPlan({
      rejected: [
        { incomingRowId: 'r-3', reason: 'missing-update-key', keyColumnIds: ['status__1'], keyValues: [null] },
        { incomingRowId: 'r-4', reason: 'incoming-duplicate-key', keyColumnIds: ['status__1'], keyValues: ['duplicate'] },
      ],
      assignments: [
        { kind: 'insert', incomingRowId: 'r-1', destinationRow: 2 },
        { kind: 'insert', incomingRowId: 'r-2', destinationRow: 3 },
        { kind: 'insert', incomingRowId: 'r-3', destinationRow: 4 },
      ],
    }));

    expect(counts).toMatchObject({ totalRows: 4, validationErrorRows: 1, planRejectedRows: 2, rejectedRows: 2, exportableRows: 2 });
  });
});
