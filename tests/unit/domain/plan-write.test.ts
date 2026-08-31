import { describe, expect, it } from 'vitest';
import { planWrite, planWriteInBatches } from '../../../src/domain/merge/plan-write';
import type { DataRow, Dataset } from '../../../src/domain/dataset/types';

function row(rowId: string, sourceRowNumber: number, values: DataRow['values']): DataRow {
  return { rowId, sourceRowNumber, values, originalValues: { ...values } };
}

function dataset(rows: DataRow[]): Dataset {
  return { columns: [], rows };
}

describe('planWrite', () => {
  it('applies the mapped-column filter in batched planning', async () => {
    const result = await planWriteInBatches({
      mode: 'append',
      incoming: dataset([
        row('valid', 2, { id__1: 1, name__1: 'Ana' }),
        row('unmapped-only', 3, { id__1: null, name__1: 'auxiliar' }),
        row('spaces', 4, { id__1: '  ', name__1: 'auxiliar' }),
      ]),
      existing: dataset([]),
      destination: { headerRow: 1, dataStartRow: 2 },
      writeColumnIds: ['id__1'],
    }, { batchSize: 1, onProgress: () => undefined });

    expect(result.inserts.map(({ incomingRowId, destinationRow }) => [incomingRowId, destinationRow])).toEqual([
      ['valid', 2],
    ]);
  });

  it('ignores incoming rows empty in every mapped column for replace, append, and update', () => {
    const incoming = dataset([
      row('incoming-1', 2, { id__1: 1, name__1: 'Ana' }),
      row('incoming-unmapped-only', 3, { id__1: null, name__1: 'auxiliar' }),
      row('incoming-empty-text', 4, { id__1: '', name__1: null }),
      row('incoming-spaces', 5, { id__1: '  ', name__1: 'auxiliar' }),
      row('incoming-2', 6, { id__1: 2, name__1: '' }),
    ]);
    const writeColumnIds = ['id__1'];

    const replace = planWrite({
      mode: 'replace',
      incoming,
      existing: dataset([]),
      destination: { headerRow: 1, dataStartRow: 10 },
      writeColumnIds,
    });
    const append = planWrite({
      mode: 'append',
      incoming,
      existing: dataset([row('existing-1', 20, { id__1: 9 })]),
      destination: { headerRow: 19, dataStartRow: 20 },
      writeColumnIds,
    });
    const update = planWrite({
      mode: 'update',
      incoming,
      existing: dataset([row('existing-1', 20, { id__1: 1, name__1: 'Antiga' })]),
      destination: { headerRow: 19, dataStartRow: 20 },
      keyColumnIds: writeColumnIds,
      writeColumnIds,
    });

    expect(replace.inserts.map(({ incomingRowId, destinationRow }) => [incomingRowId, destinationRow])).toEqual([
      ['incoming-1', 10],
      ['incoming-2', 11],
    ]);
    expect(append.inserts.map(({ incomingRowId, destinationRow }) => [incomingRowId, destinationRow])).toEqual([
      ['incoming-1', 21],
      ['incoming-2', 22],
    ]);
    expect(update.updates.map(({ incomingRowId }) => incomingRowId)).toEqual(['incoming-1']);
    expect(update.inserts.map(({ incomingRowId }) => incomingRowId)).toEqual(['incoming-2']);
    expect(update.rejected).toEqual([]);
  });

  it('plans replace by clearing only data rows and assigning valid incoming rows sequentially', () => {
    const incoming = dataset([
      row('incoming-1', 2, { id__1: 10, name__1: 'Ana' }),
      row('incoming-2', 3, { id__1: 11, name__1: 'Bia' }),
    ]);
    const existing = dataset([
      row('existing-header', 5, { id__1: 'ID', name__1: 'Name' }),
      row('existing-1', 6, { id__1: 1, name__1: 'Old 1' }),
      row('existing-2', 7, { id__1: 2, name__1: 'Old 2' }),
    ]);

    const result = planWrite({
      mode: 'replace',
      incoming,
      existing,
      destination: { headerRow: 5, dataStartRow: 6 },
    });

    expect(result.clears.map(({ destinationRow, existingRowId }) => [destinationRow, existingRowId])).toEqual([
      [6, 'existing-1'],
      [7, 'existing-2'],
    ]);
    expect(result.inserts.map(({ incomingRowId, destinationRow }) => [incomingRowId, destinationRow])).toEqual([
      ['incoming-1', 6],
      ['incoming-2', 7],
    ]);
    expect(result.assignments.map(({ incomingRowId, destinationRow }) => [incomingRowId, destinationRow])).toEqual([
      ['incoming-1', 6],
      ['incoming-2', 7],
    ]);
    expect(result.headerRow).toBe(5);
    expect(incoming.rows[0].values).toEqual({ id__1: 10, name__1: 'Ana' });
    expect(existing.rows[1].values).toEqual({ id__1: 1, name__1: 'Old 1' });
  });

  it('plans append after existing data without clearing or changing preexisting rows', () => {
    const incoming = dataset([
      row('incoming-1', 2, { id__1: 10 }),
      row('incoming-2', 3, { id__1: 11 }),
    ]);
    const existing = dataset([
      row('existing-1', 9, { id__1: 1 }),
      row('existing-2', 10, { id__1: 2 }),
    ]);

    const result = planWrite({
      mode: 'append',
      incoming,
      existing,
      destination: { headerRow: 8, dataStartRow: 9 },
    });

    expect(result.clears).toEqual([]);
    expect(result.inserts.map(({ incomingRowId, destinationRow }) => [incomingRowId, destinationRow])).toEqual([
      ['incoming-1', 11],
      ['incoming-2', 12],
    ]);
    expect(result.updates).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(existing.rows.map((currentRow) => currentRow.rowId)).toEqual(['existing-1', 'existing-2']);
  });

  it('plans single-key updates, inserts, and unchanged records without mutating either dataset', () => {
    const incoming = dataset([
      row('incoming-update', 2, { id__1: 1, name__1: 'Ana Atualizada' }),
      row('incoming-keep', 3, { id__1: 2, name__1: 'Bia' }),
      row('incoming-insert', 4, { id__1: 3, name__1: 'Caio' }),
    ]);
    const existing = dataset([
      row('existing-update', 6, { id__1: 1, name__1: 'Ana' }),
      row('existing-keep', 7, { id__1: 2, name__1: 'Bia' }),
    ]);

    const result = planWrite({
      mode: 'update',
      incoming,
      existing,
      destination: { headerRow: 5, dataStartRow: 6 },
      keyColumnIds: ['id__1'],
    });

    expect(result.updates).toEqual([{
      incomingRowId: 'incoming-update',
      existingRowId: 'existing-update',
      destinationRow: 6,
      values: { id__1: 1, name__1: 'Ana Atualizada' },
    }]);
    expect(result.kept).toEqual([{
      incomingRowId: 'incoming-keep',
      existingRowId: 'existing-keep',
      destinationRow: 7,
    }]);
    expect(result.inserts.map(({ incomingRowId, destinationRow }) => [incomingRowId, destinationRow])).toEqual([
      ['incoming-insert', 8],
    ]);
    expect(result.rejected).toEqual([]);
    expect(incoming.rows.map((currentRow) => currentRow.values)).toEqual([
      { id__1: 1, name__1: 'Ana Atualizada' },
      { id__1: 2, name__1: 'Bia' },
      { id__1: 3, name__1: 'Caio' },
    ]);
    expect(existing.rows.map((currentRow) => currentRow.values)).toEqual([
      { id__1: 1, name__1: 'Ana' },
      { id__1: 2, name__1: 'Bia' },
    ]);
  });

  it('compares only resolved exported fields when deciding whether an update changed', () => {
    const incoming = dataset([
      row('incoming-keep', 2, { id__1: 1, name__1: 'Ana', ignored__1: 'novo' }),
      row('incoming-fixed-update', 3, { id__1: 2, name__1: 'Valor fixo', ignored__1: 'qualquer' }),
    ]);
    const existing = dataset([
      row('existing-keep', 6, { id__1: 1, name__1: 'Ana', ignored__1: null }),
      row('existing-update', 7, { id__1: 2, name__1: 'Valor antigo', ignored__1: null }),
    ]);

    const result = planWrite({
      mode: 'update',
      incoming,
      existing,
      destination: { headerRow: 5, dataStartRow: 6 },
      keyColumnIds: ['id__1'],
      comparedColumnIds: ['id__1', 'name__1'],
    });

    expect(result.kept.map(({ incomingRowId }) => incomingRowId)).toEqual(['incoming-keep']);
    expect(result.updates).toEqual([{
      incomingRowId: 'incoming-fixed-update',
      existingRowId: 'existing-update',
      destinationRow: 7,
      values: { id__1: 2, name__1: 'Valor fixo', ignored__1: 'qualquer' },
    }]);
  });

  it('uses composite keys and explicitly rejects every ambiguous incoming or existing duplicate', () => {
    const incoming = dataset([
      row('incoming-update', 2, { office__1: 'SP', code__1: 'A', name__1: 'Ana Atualizada' }),
      row('incoming-duplicate-1', 3, { office__1: 'RJ', code__1: 'B', name__1: 'Bia 1' }),
      row('incoming-duplicate-2', 4, { office__1: 'RJ', code__1: 'B', name__1: 'Bia 2' }),
      row('incoming-existing-conflict', 5, { office__1: 'BH', code__1: 'C', name__1: 'Caio' }),
    ]);
    const existing = dataset([
      row('existing-update', 10, { office__1: 'SP', code__1: 'A', name__1: 'Ana' }),
      row('existing-duplicate-1', 11, { office__1: 'BH', code__1: 'C', name__1: 'Caio 1' }),
      row('existing-duplicate-2', 12, { office__1: 'BH', code__1: 'C', name__1: 'Caio 2' }),
    ]);

    const result = planWrite({
      mode: 'update',
      incoming,
      existing,
      destination: { headerRow: 9, dataStartRow: 10 },
      keyColumnIds: ['office__1', 'code__1'],
    });

    expect(result.updates.map(({ incomingRowId, destinationRow }) => [incomingRowId, destinationRow])).toEqual([
      ['incoming-update', 10],
    ]);
    expect(result.duplicates).toEqual([
      {
        scope: 'incoming',
        keyColumnIds: ['office__1', 'code__1'],
        keyValues: ['RJ', 'B'],
        rowIds: ['incoming-duplicate-1', 'incoming-duplicate-2'],
      },
      {
        scope: 'existing',
        keyColumnIds: ['office__1', 'code__1'],
        keyValues: ['BH', 'C'],
        rowIds: ['existing-duplicate-1', 'existing-duplicate-2'],
      },
    ]);
    expect(result.rejected.map(({ incomingRowId, reason }) => [incomingRowId, reason])).toEqual([
      ['incoming-duplicate-1', 'incoming-duplicate-key'],
      ['incoming-duplicate-2', 'incoming-duplicate-key'],
      ['incoming-existing-conflict', 'existing-duplicate-key'],
    ]);
    expect(result.inserts).toEqual([]);
    expect(result.kept).toEqual([]);
  });
});
