import { describe, expect, it } from 'vitest';
import { readCsv } from '../../../src/io/source/read-csv';
import { SourceReadError } from '../../../src/io/source/read-source';
import {
  classifyDatasetMemory,
  estimateDatasetBytes,
} from '../../../src/utils/memory-estimate';

describe('readCsv', () => {
  it('uses an explicit semicolon delimiter and preserves source row numbers', async () => {
    const dataset = await readCsv(new File([
      'ID;Nome\n1;Ana\n2;Bruno\n',
    ], 'dados.csv'), { delimiter: ';' });

    expect(dataset.columns.map((column) => column.header)).toEqual(['ID', 'Nome']);
    expect(dataset.rows[1].sourceRowNumber).toBe(3);
    expect(dataset.rows[1].values.nome__1).toBe('Bruno');
  });

  it('auto-detects comma delimiters and keeps delimiters inside quoted values', async () => {
    const dataset = await readCsv(new File([
      'Nome,Cidade\n"Ana, Maria","Rio, RJ"\n',
    ], 'dados.csv'));

    expect(dataset.rows).toHaveLength(1);
    expect(dataset.rows[0].values).toEqual({
      nome__1: 'Ana, Maria',
      cidade__1: 'Rio, RJ',
    });
  });

  it('removes a UTF-8 BOM, skips empty rows, and keeps duplicate headers distinct', async () => {
    const dataset = await readCsv(new File([
      '\ufeffValor;Valor\nprimeiro;segundo\n;\nterceiro;quarto\n',
    ], 'dados.csv'), { delimiter: ';' });

    expect(dataset.columns.map((column) => column.id)).toEqual(['valor__1', 'valor__2']);
    expect(dataset.rows).toHaveLength(2);
    expect(dataset.rows[1]).toMatchObject({
      sourceRowNumber: 4,
      values: { valor__1: 'terceiro', valor__2: 'quarto' },
    });
  });

  it('raises structured errors instead of silently dropping malformed rows', async () => {
    await expect(readCsv(new File([
      'Nome;Cidade\n"Ana;São Paulo\n',
    ], 'dados.csv'), { delimiter: ';' })).rejects.toMatchObject({
      name: 'SourceReadError',
      issues: [expect.objectContaining({ code: 'MissingQuotes' })],
    } satisfies Partial<SourceReadError>);
  });
});

describe('dataset memory advisory', () => {
  it('classifies the estimated dataset footprint against the supplied threshold', () => {
    const dataset = {
      columns: [{
        id: 'nome__1',
        header: 'Nome',
        sourceIndex: 0,
        detectedType: 'string' as const,
      }],
      rows: [{
        rowId: 'row-2',
        sourceRowNumber: 2,
        values: { nome__1: 'Ana' },
        originalValues: { nome__1: 'Ana' },
      }],
    };
    const bytes = estimateDatasetBytes(dataset);

    expect(bytes).toBeGreaterThan(0);
    expect(classifyDatasetMemory(bytes, { sessionThresholdBytes: bytes })).toBe('safe');
    expect(classifyDatasetMemory(bytes, { sessionThresholdBytes: bytes - 1 })).toBe('warning');
    expect(classifyDatasetMemory(bytes * 2, { sessionThresholdBytes: bytes })).toBe('high-risk');
  });
});
