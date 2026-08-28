import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WritePlan } from '../../../src/domain/merge/types';
import type { ValidationResult } from '../../../src/domain/validation/types';
import {
  exportWorkbook,
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

const valid: ValidationResult = { isValid: true, issues: [] };

let pkg: OoxmlPackage;

beforeEach(async () => {
  const bytes = await readFile(fixtureUrl);
  pkg = await openOoxmlPackage(toArrayBuffer(bytes));
});

describe('exportWorkbook', () => {
  it('exports thousands of rows without quadratic worksheet rewrites', async () => {
    const inserts = Array.from({ length: 2_000 }, (_, index) => ({
      incomingRowId: `large-${index}`,
      destinationRow: index + 6,
      values: {
        source_id: index + 1,
        source_product: `Produto ${index + 1}`,
        source_quantity: 1,
        source_price: 2.5,
      },
    }));
    const writePlan: WritePlan = {
      mode: 'append',
      headerRow: 2,
      clears: [],
      inserts,
      updates: [],
      kept: [],
      duplicates: [],
      rejected: [],
      assignments: inserts.map(({ incomingRowId, destinationRow }) => ({
        kind: 'insert' as const,
        incomingRowId,
        destinationRow,
      })),
    };

    const started = performance.now();
    const output = await exportWorkbook(input(writePlan, valid), {
      batchSize: 500,
      onProgress: () => undefined,
    });

    expect(output.size).toBeGreaterThan(1_000);
    expect(performance.now() - started).toBeLessThan(5_000);
  }, 10_000);

  it('applies replace writes while preserving headers, styles, formulas, and unrelated parts', async () => {
    const untouched = snapshotParts(pkg, [
      'xl/drawings/drawing1.xml',
      'xl/charts/chart1.xml',
      'xl/media/image1.png',
      'customXml/item1.xml',
    ]);
    const originalPackage = snapshotParts(pkg, pkg.listParts());
    const writePlan: WritePlan = {
      mode: 'replace',
      headerRow: 2,
      clears: [
        { existingRowId: 'old-1', destinationRow: 3 },
        { existingRowId: 'old-2', destinationRow: 4 },
        { existingRowId: 'old-3', destinationRow: 5 },
      ],
      inserts: [
        { incomingRowId: 'new-1', destinationRow: 3, values: {
          source_id: 101,
          source_product: 'Lápis & papel',
          source_quantity: 5,
          source_price: 2.5,
        } },
        { incomingRowId: 'new-2', destinationRow: 4, values: {
          source_id: 102,
          source_product: 'Borracha',
          source_quantity: 3,
          source_price: 4,
        } },
      ],
      updates: [],
      kept: [],
      duplicates: [],
      rejected: [],
      assignments: [
        { kind: 'insert', incomingRowId: 'new-1', destinationRow: 3 },
        { kind: 'insert', incomingRowId: 'new-2', destinationRow: 4 },
      ],
    };

    const output = await exportWorkbook(input(writePlan, valid));
    const exported = await openOoxmlPackage(await output.arrayBuffer());
    const worksheet = textPart(exported, 'xl/worksheets/sheet1.xml');

    expect(output.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(worksheet).toContain('<c r="A2" s="1" t="inlineStr"><is><t>ID</t></is></c>');
    expect(worksheet).toContain('<c r="A3"><v>101</v></c>');
    expect(worksheet).toContain(
      '<c r="B3" t="inlineStr"><is><t>Lápis &amp; papel</t></is></c>',
    );
    expect(worksheet).toContain('<c r="D3" s="2"><v>2.5</v></c>');
    expect(worksheet).toContain('<c r="E3" s="2"><f>C3*D3</f><v>31</v></c>');
    expect(worksheet).toContain('<c r="A5"/>');
    expect(worksheet).toContain('<c r="D5" s="2"/>');
    expect(textPart(exported, 'xl/worksheets/sheet2.xml')).not.toContain('<sheetProtection');
    expect(textPart(pkg, 'xl/worksheets/sheet2.xml')).toContain('<sheetProtection');

    expectParts(exported, untouched);
    expectParts(pkg, originalPackage);
    expectParts(
      exported,
      new Map([...originalPackage].filter(([path]) => (
        path !== 'xl/worksheets/sheet1.xml'
        && path !== 'xl/worksheets/sheet2.xml'
      ))),
    );
  });

  it('writes values into a legal self-closing destination row', async () => {
    const originalWorksheet = textPart(pkg, 'xl/worksheets/sheet1.xml');
    pkg.updatePart(
      'xl/worksheets/sheet1.xml',
      originalWorksheet.replace(
        /<row r="3">[\s\S]*?<\/row>/,
        '<row r="3"/>',
      ),
    );

    const output = await exportWorkbook(input({
      mode: 'replace',
      headerRow: 2,
      clears: [{ existingRowId: 'old-1', destinationRow: 3 }],
      inserts: [{
        incomingRowId: 'new-1',
        destinationRow: 3,
        values: {
          source_id: 201,
          source_product: 'Linha preenchida',
          source_quantity: 1,
          source_price: 8,
        },
      }],
      updates: [],
      kept: [],
      duplicates: [],
      rejected: [],
      assignments: [{ kind: 'insert', incomingRowId: 'new-1', destinationRow: 3 }],
    }, valid));
    const exported = await openOoxmlPackage(await output.arrayBuffer());
    const worksheet = textPart(exported, 'xl/worksheets/sheet1.xml');

    expect(worksheet).toContain('<row r="3"><c r="A3"><v>201</v></c>');
    expect(worksheet).toContain('<c r="B3" t="inlineStr"><is><t>Linha preenchida</t></is></c>');
  });

  it('expands append rows with shifted formulas and destination styles', async () => {
    const originalPackage = snapshotParts(pkg, pkg.listParts());
    const writePlan: WritePlan = {
      mode: 'append',
      headerRow: 2,
      clears: [],
      inserts: [
        { incomingRowId: 'new-4', destinationRow: 6, values: {
          source_id: 4,
          source_product: 'Mochila',
          source_quantity: 2,
          source_price: 40,
        } },
        { incomingRowId: 'new-5', destinationRow: 7, values: {
          source_id: 5,
          source_product: 'Estojo',
          source_quantity: 1,
          source_price: 12.75,
        } },
      ],
      updates: [],
      kept: [],
      duplicates: [],
      rejected: [],
      assignments: [
        { kind: 'insert', incomingRowId: 'new-4', destinationRow: 6 },
        { kind: 'insert', incomingRowId: 'new-5', destinationRow: 7 },
      ],
    };

    const output = await exportWorkbook(input(writePlan, valid));
    const exported = await openOoxmlPackage(await output.arrayBuffer());
    const worksheet = textPart(exported, 'xl/worksheets/sheet1.xml');
    const drawing = textPart(exported, 'xl/drawings/drawing1.xml');

    expect(worksheet).toContain('<c r="A6"><v>4</v></c>');
    expect(worksheet).toContain('<c r="D6" s="2"><v>40</v></c>');
    expect(worksheet).toContain('<c r="E6" s="2"><f>C6*D6</f>');
    expect(worksheet).toContain('<c r="E7" s="2"><f>C7*D7</f>');
    expect(worksheet).toContain('<c r="E8" s="2"><f>SUM(E3:E7)</f>');
    expect(drawing).toContain('<xdr:to><xdr:col>11</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>12</xdr:row>');
    expect(drawing).toContain('<xdr:from><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>13</xdr:row>');
    expect(textPart(exported, 'xl/tables/table1.xml')).toContain('ref="A2:D7"');
    expect(textPart(exported, 'xl/worksheets/sheet2.xml')).not.toContain('<sheetProtection');
    expect(textPart(pkg, 'xl/worksheets/sheet2.xml')).toContain('<sheetProtection');
    expectParts(
      exported,
      new Map([...originalPackage].filter(([path]) => (
        path !== 'xl/worksheets/sheet1.xml'
        && path !== 'xl/worksheets/sheet2.xml'
        && path !== 'xl/tables/table1.xml'
        && path !== 'xl/drawings/drawing1.xml'
      ))),
    );
  });

  it('applies planned updates and valid inserts but routes invalid rows only to rejection sheet', async () => {
    const writePlan: WritePlan = {
      mode: 'update',
      headerRow: 2,
      clears: [],
      inserts: [
        { incomingRowId: 'valid-insert', destinationRow: 6, values: {
          source_id: 4,
          source_product: 'Apontador',
          source_quantity: 7,
          source_price: 1.5,
        } },
        { incomingRowId: 'invalid-insert', destinationRow: 7, values: {
          source_id: 5,
          source_product: 'NÃO EXPORTAR',
          source_quantity: -1,
          source_price: 9,
        } },
      ],
      updates: [{
        incomingRowId: 'valid-update',
        existingRowId: 'old-2',
        destinationRow: 4,
        values: {
          source_id: 2,
          source_product: 'Caneta azul',
          source_quantity: 12,
          source_price: 3.5,
        },
      }],
      kept: [{ incomingRowId: 'kept', existingRowId: 'old-1', destinationRow: 3 }],
      duplicates: [],
      rejected: [],
      assignments: [
        { kind: 'keep', incomingRowId: 'kept', existingRowId: 'old-1', destinationRow: 3 },
        { kind: 'update', incomingRowId: 'valid-update', existingRowId: 'old-2', destinationRow: 4 },
        { kind: 'insert', incomingRowId: 'valid-insert', destinationRow: 6 },
        { kind: 'insert', incomingRowId: 'invalid-insert', destinationRow: 7 },
      ],
    };
    const validation: ValidationResult = {
      isValid: false,
      issues: [{
        rowId: 'invalid-insert',
        sourceRowNumber: 9,
        columnId: 'source_quantity',
        code: 'numberRange',
        value: -1,
        message: 'Quantidade deve ser positiva',
      }, {
        rowId: 'valid-insert',
        sourceRowNumber: 8,
        columnId: 'source_product',
        code: 'conditional_no_match',
        value: 'Apontador',
        message: 'Contexto não cadastrado',
        severity: 'warning',
      }],
    };

    const output = await exportWorkbook({
      ...input(writePlan, validation),
      rejectedRows: [{
        sourceRowNumber: 9,
        originalRelevantFields: { Produto: 'NÃO EXPORTAR', Quantidade: -1 },
        errorField: 'Quantidade',
        invalidValue: -1,
        rejectionReason: 'Quantidade deve ser positiva',
        failedRuleOrTransform: 'numberRange',
      }],
    });
    const exported = await openOoxmlPackage(await output.arrayBuffer());
    const worksheet = textPart(exported, 'xl/worksheets/sheet1.xml');

    expect(worksheet).toContain('<c r="B4" t="inlineStr"><is><t>Caneta azul</t></is></c>');
    expect(worksheet).toContain('<c r="A6"><v>4</v></c>');
    expect(worksheet).toContain('Apontador');
    expect(worksheet).not.toContain('NÃO EXPORTAR');
    expect(worksheet).not.toContain('<row r="7"><c r="A7"><v>5</v>');
    expect(textPart(exported, 'xl/worksheets/sheet3.xml')).toContain('NÃO EXPORTAR');
  });
});

function input(writePlan: WritePlan, validationResult: ValidationResult): ExportInput {
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
      acceptedMapping('source_id', 'target_id'),
      acceptedMapping('source_product', 'target_product'),
      acceptedMapping('source_quantity', 'target_quantity'),
      acceptedMapping('source_price', 'target_price'),
    ],
    writePlan,
    validationResult,
  };
}

function acceptedMapping(sourceColumnId: string, destinationColumnId: string) {
  return {
    sourceColumnId,
    destinationColumnId,
    confidence: 'exact' as const,
    score: 1,
    status: 'accepted' as const,
  };
}

function snapshotParts(pkgToRead: OoxmlPackage, paths: readonly string[]) {
  return new Map(paths.map((path) => [path, pkgToRead.readPart(path)]));
}

function expectParts(pkgToRead: OoxmlPackage, expected: ReadonlyMap<string, Uint8Array>) {
  for (const [path, bytes] of expected) {
    expect(pkgToRead.readPart(path), path).toEqual(bytes);
  }
}

function textPart(pkgToRead: OoxmlPackage, path: string): string {
  return new TextDecoder().decode(pkgToRead.readPart(path));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
