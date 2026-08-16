import { describe, expect, it, vi } from 'vitest';
import { readCsv } from '../../../src/io/source/read-csv';
import { SourceReadError } from '../../../src/io/source/read-source';
import {
  classifyDatasetMemory,
  estimateDatasetBytes,
} from '../../../src/utils/memory-estimate';

describe('readCsv', () => {
  it('converts consistent numeric CSV columns without changing text columns', async () => {
    const dataset = await readCsv(new File([
      'ID;Preço;Nome\n1;1,37;Ana\n2;2,50;Bruno\n',
    ], 'dados.csv'), { delimiter: ';' });

    expect(dataset.columns.map((column) => column.detectedType)).toEqual(['number', 'number', 'string']);
    expect(dataset.rows.map((row) => row.values.id__1)).toEqual([1, 2]);
    expect(dataset.rows.map((row) => row.values[dataset.columns[1].id])).toEqual([1.37, 2.5]);
    expect(dataset.rows.map((row) => row.values.nome__1)).toEqual(['Ana', 'Bruno']);
  });

  it('preserves zero-padded and mixed numeric-looking CSV values as text', async () => {
    const dataset = await readCsv(new File([
      'Código;Valor\n001;1\n002;indefinido\n',
    ], 'dados.csv'), { delimiter: ';' });

    expect(dataset.columns.map((column) => column.detectedType)).toEqual(['string', 'string']);
    expect(dataset.rows[0].values[dataset.columns[0].id]).toBe('001');
    expect(dataset.rows[0].values[dataset.columns[1].id]).toBe('1');
  });

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

  it('reads browser files in chunks without calling File.text for the whole file', async () => {
    class ChunkedFileReader {
      result: string | null = null;
      onload: ((event: { target: ChunkedFileReader }) => void) | null = null;
      onerror: (() => void) | null = null;

      readAsText(chunk: Blob): void {
        void chunk.text().then((result) => {
          this.result = result;
          this.onload?.({ target: this });
        }, () => this.onerror?.());
      }
    }

    class StreamingOnlyFile extends File {
      override text(): Promise<string> {
        return Promise.reject(new Error('read the file in chunks'));
      }
    }

    vi.stubGlobal('FileReader', ChunkedFileReader);

    try {
      const dataset = await readCsv(new StreamingOnlyFile([
        'ID;Nome\n1;Ana\n2;Bruno\n',
      ], 'dados.csv'), { delimiter: ';' });

      expect(dataset.rows.map((row) => row.values.nome__1)).toEqual(['Ana', 'Bruno']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('auto-detects semicolon delimiters in browser chunk mode', async () => {
    class ChunkedFileReader {
      result: string | null = null;
      onload: ((event: { target: ChunkedFileReader }) => void) | null = null;
      onerror: (() => void) | null = null;

      readAsText(chunk: Blob): void {
        void chunk.text().then((result) => {
          this.result = result;
          this.onload?.({ target: this });
        }, () => this.onerror?.());
      }
    }

    vi.stubGlobal('FileReader', ChunkedFileReader);
    try {
      const dataset = await readCsv(new File([
        'ID;Nome\n1;Ana\n',
      ], 'dados.csv'));
      expect(dataset.columns.map((column) => column.header)).toEqual(['ID', 'Nome']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('raises structured errors when a row contains populated fields beyond its headers', async () => {
    await expect(readCsv(new File([
      'ID;Nome\n1;Ana;descartado\n',
    ], 'dados.csv'), { delimiter: ';' })).rejects.toMatchObject({
      name: 'SourceReadError',
      issues: [expect.objectContaining({
        code: 'TooManyFields',
        row: 2,
        message: 'A linha de origem contém campos preenchidos além do cabeçalho.',
      })],
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
