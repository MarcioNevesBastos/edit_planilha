import { readFile } from 'node:fs/promises';
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
});
