import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { extractDestinationDataset } from '../../../src/io/template/extract-destination';
import { indexWorkbook } from '../../../src/io/template/workbook-index';
import { openOoxmlPackage } from '../../../src/io/template/ooxml-package';
import { prepareOutputBase } from '../../../src/io/template/output-base';
import type { DatasetColumn } from '../../../src/domain/dataset/types';
import { exportWorkbook } from '../../../src/io/template/export-workbook';

const columns: DatasetColumn[] = [
  { id: 'id__1', header: 'ID', sourceIndex: 0, detectedType: 'number' },
  { id: 'nome__1', header: 'Nome', sourceIndex: 1, detectedType: 'string' },
];

async function fixtureBuffer(): Promise<ArrayBuffer> {
  const bytes = await readFile('src/test-fixtures/workbooks/template-structured.xlsx');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('output base preparation', () => {
  it('creates a minimal workbook with an automatic destination', async () => {
    const result = await prepareOutputBase({ mode: 'none', columns });

    expect(result.destination).toEqual({
      sheetName: 'Dados Preparados',
      range: 'A1:B2',
      dataStartRow: 2,
      templateRow: 2,
    });

    const index = await indexWorkbook(await openOoxmlPackage(result.buffer));
    expect(index.sheets.map(({ name }) => name)).toEqual(['Dados Preparados']);
    expect(extractDestinationDataset(result.buffer, 'Dados Preparados', 'A1:B2')).toMatchObject({
      columns: [
        expect.objectContaining({ header: 'ID' }),
        expect.objectContaining({ header: 'Nome' }),
      ],
      rows: [],
    });
  });

  it('adds a unique output sheet while preserving the source workbook', async () => {
    const sourceBuffer = await fixtureBuffer();
    const sourcePackage = await openOoxmlPackage(sourceBuffer);
    const originalParts = new Map(sourcePackage.listParts().map((path) => [
      path,
      sourcePackage.readPart(path),
    ]));

    const first = await prepareOutputBase({ mode: 'source', sourceBuffer, columns });
    const second = await prepareOutputBase({ mode: 'source', sourceBuffer: first.buffer, columns });
    const firstIndex = await indexWorkbook(await openOoxmlPackage(first.buffer));
    const secondIndex = await indexWorkbook(await openOoxmlPackage(second.buffer));

    expect(first.destination.sheetName).toBe('Dados Preparados');
    expect(second.destination.sheetName).toBe('Dados Preparados 2');
    expect(firstIndex.sheets.map(({ name }) => name)).toEqual(['Dados Modelo', 'Protegida', 'Dados Preparados']);
    expect(secondIndex.sheets.map(({ name }) => name)).toEqual(['Dados Modelo', 'Protegida', 'Dados Preparados', 'Dados Preparados 2']);

    const resultPackage = await openOoxmlPackage(first.buffer);
    for (const [path, bytes] of originalParts) {
      if (path === 'xl/workbook.xml'
        || path === 'xl/_rels/workbook.xml.rels'
        || path === '[Content_Types].xml') continue;
      expect(resultPackage.readPart(path)).toEqual(bytes);
    }
  });

  it('rejects an output base without columns', async () => {
    await expect(prepareOutputBase({ mode: 'none', columns: [] })).rejects.toThrow(
      'A saída automática exige pelo menos uma coluna.',
    );
  });

  it('exports treated rows into the generated workbook', async () => {
    const prepared = await prepareOutputBase({ mode: 'none', columns });
    const destination = {
      ...prepared.destination,
      columns: columns.map((column, index) => ({ id: column.id, column: String.fromCharCode(65 + index) })),
    };
    const buffer = await (await exportWorkbook({
      package: await openOoxmlPackage(prepared.buffer),
      destination,
      mappings: columns.map((column) => ({
        sourceColumnId: column.id,
        destinationColumnId: column.id,
        confidence: 'exact' as const,
        score: 1,
        status: 'accepted' as const,
      })),
      writePlan: {
        mode: 'replace',
        headerRow: 1,
        clears: [],
        inserts: [{
          incomingRowId: 'source-2',
          destinationRow: 2,
          values: { id__1: 1, nome__1: 'Ana' },
        }],
        updates: [],
        kept: [],
        duplicates: [],
        rejected: [],
        assignments: [{ kind: 'insert', incomingRowId: 'source-2', destinationRow: 2 }],
      },
      validationResult: { isValid: true, issues: [] },
    })).arrayBuffer();

    expect(extractDestinationDataset(buffer, 'Dados Preparados', 'A1:B2').rows[0]?.values).toEqual({
      id__1: 1,
      nome__2: 'Ana',
    });
  });
});
