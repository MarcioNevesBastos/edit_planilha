import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WritePlan } from '../../../src/domain/merge/types';
import {
  exportWorkbook,
  scanExportRisks,
  type ExportInput,
} from '../../../src/io/template/export-workbook';
import {
  openOoxmlPackage,
  type OoxmlPackage,
} from '../../../src/io/template/ooxml-package';

const fixtureUrl = new URL(
  '../../../src/test-fixtures/workbooks/template-structured.xlsx',
  import.meta.url,
);

let source: OoxmlPackage;

beforeEach(async () => {
  const bytes = await readFile(fixtureUrl);
  source = await openOoxmlPackage(toArrayBuffer(bytes));
});

describe('tested OOXML compatibility matrix', () => {
  it('preserves every reference feature or updates its declared structural range', async () => {
    const output = await exportWorkbook(exportInput(source));
    const exported = await openOoxmlPackage(await output.arrayBuffer());
    const worksheet = textPart(exported, 'xl/worksheets/sheet1.xml');
    const table = textPart(exported, 'xl/tables/table1.xml');

    const matrix = [
      {
        feature: 'styles',
        status: 'preserved',
        verified: samePart(source, exported, 'xl/styles.xml')
          && worksheet.includes('<c r="D6" s="2"><v>5.5</v></c>'),
      },
      {
        feature: 'formulas',
        status: 'preserved',
        verified: worksheet.includes('<c r="E3" s="2"><f>C3*D3</f><v>31</v></c>')
          && worksheet.includes('<c r="E6" s="2"><f>C6*D6</f>'),
      },
      {
        feature: 'validation',
        status: 'preserved-and-expanded',
        verified: worksheet.includes('sqref="C3:C101"')
          && worksheet.includes('<formula1>0</formula1>'),
      },
      {
        feature: 'merges',
        status: 'preserved',
        verified: worksheet.includes('<mergeCells count="1"><mergeCell ref="A1:F1"/></mergeCells>'),
      },
      {
        feature: 'images',
        status: 'preserved',
        verified: samePart(source, exported, 'xl/media/image1.png')
          && samePart(source, exported, 'xl/drawings/drawing1.xml'),
      },
      {
        feature: 'charts',
        status: 'preserved',
        verified: samePart(source, exported, 'xl/charts/chart1.xml'),
      },
      {
        feature: 'tables',
        status: 'preserved-and-expanded',
        verified: table.includes('ref="A2:D6"')
          && table.includes('<autoFilter ref="A2:D6"/>'),
      },
      {
        feature: 'filters',
        status: 'preserved-and-expanded',
        verified: worksheet.includes('<autoFilter ref="A2:E6"/>'),
      },
      {
        feature: 'frozen panes',
        status: 'preserved',
        verified: worksheet.includes('<pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/>'),
      },
      {
        feature: 'print settings',
        status: 'preserved',
        verified: worksheet.includes('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'),
      },
    ] as const;

    expect(matrix.map(({ feature, status }) => ({ feature, status }))).toEqual([
      { feature: 'styles', status: 'preserved' },
      { feature: 'formulas', status: 'preserved' },
      { feature: 'validation', status: 'preserved-and-expanded' },
      { feature: 'merges', status: 'preserved' },
      { feature: 'images', status: 'preserved' },
      { feature: 'charts', status: 'preserved' },
      { feature: 'tables', status: 'preserved-and-expanded' },
      { feature: 'filters', status: 'preserved-and-expanded' },
      { feature: 'frozen panes', status: 'preserved' },
      { feature: 'print settings', status: 'preserved' },
    ]);
    expect(matrix.filter(({ verified }) => !verified)).toEqual([]);
  });

  it('hard-blocks a merge conflict and soft-warns before overwriting a formula', async () => {
    source.updatePart(
      'xl/worksheets/sheet1.xml',
      textPart(source, 'xl/worksheets/sheet1.xml')
        .replace('<mergeCells count="1"><mergeCell ref="A1:F1"/></mergeCells>', '<mergeCells count="2"><mergeCell ref="A1:F1"/><mergeCell ref="A6:B6"/></mergeCells>'),
    );
    const input = exportInput(source);
    input.destination.columns = [
      ...input.destination.columns,
      { id: 'target_total', column: 'E' },
    ];
    input.mappings = [
      ...input.mappings,
      {
        sourceColumnId: 'source_total',
        destinationColumnId: 'target_total',
        confidence: 'exact',
        score: 1,
        status: 'accepted',
      },
    ];
    input.writePlan.inserts[0].values.source_total = 99;

    expect(await scanExportRisks(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'merged-cell-write-conflict', severity: 'hard' }),
      expect.objectContaining({ code: 'formula-overwrite', severity: 'soft' }),
    ]));
  });
});

function exportInput(pkg: OoxmlPackage): ExportInput {
  const writePlan: WritePlan = {
    mode: 'append',
    headerRow: 2,
    clears: [],
    inserts: [{
      incomingRowId: 'new-4',
      destinationRow: 6,
      values: {
        source_id: 4,
        source_product: 'Marcador',
        source_quantity: 2,
        source_price: 5.5,
      },
    }],
    updates: [],
    kept: [],
    duplicates: [],
    rejected: [],
    assignments: [{ kind: 'insert', incomingRowId: 'new-4', destinationRow: 6 }],
  };

  return {
    package: pkg,
    destination: {
      sheetName: 'Dados Modelo',
      range: 'A2:D5',
      dataStartRow: 3,
      templateRow: 5,
      tablePath: 'xl/tables/table1.xml',
      columns: [
        { id: 'target_id', column: 'A' },
        { id: 'target_product', column: 'B' },
        { id: 'target_quantity', column: 'C' },
        { id: 'target_price', column: 'D' },
      ],
    },
    mappings: [
      ['source_id', 'target_id'],
      ['source_product', 'target_product'],
      ['source_quantity', 'target_quantity'],
      ['source_price', 'target_price'],
    ].map(([sourceColumnId, destinationColumnId]) => ({
      sourceColumnId,
      destinationColumnId,
      confidence: 'exact' as const,
      score: 1,
      status: 'accepted' as const,
    })),
    writePlan,
    validationResult: { isValid: true, issues: [] },
  };
}

function samePart(left: OoxmlPackage, right: OoxmlPackage, path: string): boolean {
  return Buffer.from(left.readPart(path)).equals(Buffer.from(right.readPart(path)));
}

function textPart(pkg: OoxmlPackage, path: string): string {
  return new TextDecoder().decode(pkg.readPart(path));
}

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
