import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { listSourceSheets, readSource } from '../../../src/io/source/read-source';

const fixtureUrl = new URL(
  '../../../src/test-fixtures/workbooks/source-basic.xlsx',
  import.meta.url,
);

async function sourceFixture(): Promise<File> {
  const content = await readFile(fixtureUrl);

  return new File([content], 'source-basic.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function largeSourceFixture(): File {
  const rows = Array.from({ length: 501 }, (_, rowIndex) =>
    Array.from({ length: 500 }, (_, columnIndex) => rowIndex === 0
      ? `Coluna ${columnIndex + 1}`
      : `${rowIndex}-${columnIndex}`));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Dados');
  const content = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new File([content], 'large-source.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('XLSX source reader', () => {
  it('lists sheets and reads only the selected sheet into the canonical dataset', async () => {
    const file = await sourceFixture();

    await expect(listSourceSheets(file)).resolves.toEqual(['Dados', 'Ignorada']);

    const dataset = await readSource(file, { sheetName: 'Dados' });

    expect(dataset.columns.map((column) => column.header)).toEqual([
      'Cliente',
      'Valor',
      'Data',
    ]);
    expect(dataset.columns.map((column) => column.detectedType)).toEqual([
      'string',
      'number',
      'date',
    ]);
    expect(dataset.rows[1]).toMatchObject({
      sourceRowNumber: 3,
      values: {
        cliente__1: 'Bruno',
        valor__1: 23.75,
        data__1: '2026-08-11',
      },
    });
    expect(dataset.columns.some((column) => column.header === 'Ignorar')).toBe(false);
  });

  it('rejects selected sheets that exceed the configured cell bound before materializing them', async () => {
    await expect(readSource(await sourceFixture(), {
      sheetName: 'Dados',
      maxCells: 8,
    })).rejects.toMatchObject({
      name: 'SourceReadError',
      issues: [expect.objectContaining({
        code: 'WorksheetRangeTooLarge',
        message: 'O intervalo da aba selecionada contém 9 células e excede o limite de importação de 8 células.',
      })],
    });
  });

  it('accepts a sheet above the former default bound when it remains within the safe default', async () => {
    const dataset = await readSource(largeSourceFixture());

    expect(dataset.columns).toHaveLength(500);
    expect(dataset.rows).toHaveLength(500);
    expect(dataset.rows[499]?.sourceRowNumber).toBe(501);
  });
});
