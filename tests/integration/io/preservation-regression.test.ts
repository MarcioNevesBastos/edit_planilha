import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WritePlan } from '../../../src/domain/merge/types';
import {
  ExportCompatibilityError,
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

let pkg: OoxmlPackage;

beforeEach(async () => {
  const bytes = await readFile(fixtureUrl);
  pkg = await openOoxmlPackage(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
});

describe('export compatibility risks', () => {
  it('blocks protected destinations before mutating the input package', async () => {
    const protectedInput = baseInput({
      sheetName: 'Protegida',
      range: 'A1:C4',
      dataStartRow: 2,
      templateRow: 4,
      columns: [
        { id: 'target_id', column: 'A' },
        { id: 'target_product', column: 'B' },
      ],
    });
    const before = pkg.readPart('xl/worksheets/sheet2.xml');

    const risks = await scanExportRisks(protectedInput);

    expect(risks).toContainEqual(expect.objectContaining({
      code: 'protected-destination-sheet',
      severity: 'hard',
    }));
    await expect(exportWorkbook(protectedInput)).rejects.toMatchObject({
      name: 'ExportCompatibilityError',
      risks: expect.arrayContaining([
        expect.objectContaining({ code: 'protected-destination-sheet' }),
      ]),
    });
    expect(pkg.readPart('xl/worksheets/sheet2.xml')).toEqual(before);
  });

  it('blocks encrypted-package sentinels, merged write cells, and unknown table structures', async () => {
    pkg.addPart('EncryptionInfo', new Uint8Array([1, 2, 3]));
    pkg.updatePart(
      'xl/tables/table1.xml',
      textPart('xl/tables/table1.xml').replace('</table>', '<extLst><ext uri="unknown"/></extLst></table>'),
    );
    const risky = baseInput({
      sheetName: 'Dados Modelo',
      range: 'A1:D5',
      dataStartRow: 1,
      templateRow: 5,
      tablePath: 'xl/tables/table1.xml',
      columns: [
        { id: 'target_id', column: 'A' },
        { id: 'target_product', column: 'B' },
      ],
    });
    risky.writePlan.headerRow = 1;
    risky.writePlan.inserts[0].destinationRow = 1;

    const risks = await scanExportRisks(risky);

    expect(risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unsupported-encrypted-package', severity: 'hard' }),
      expect.objectContaining({ code: 'merged-cell-write-conflict', severity: 'hard' }),
      expect.objectContaining({ code: 'unknown-table-structure', severity: 'hard' }),
    ]));
  });

  it('requires explicit review for soft formula-overwrite risks', async () => {
    const risky = baseInput({
      sheetName: 'Dados Modelo',
      range: 'A2:E5',
      dataStartRow: 3,
      templateRow: 5,
      tablePath: undefined,
      definedName: { name: 'DestinoPrincipal', localSheetId: null },
      columns: [{ id: 'target_product', column: 'E' }],
    });
    risky.mappings = [{
      sourceColumnId: 'source_product',
      destinationColumnId: 'target_product',
      confidence: 'exact',
      score: 1,
      status: 'accepted',
    }];
    risky.writePlan.inserts[0].values = { source_product: 'Mochila' };

    const risks = await scanExportRisks(risky);

    expect(risks).toContainEqual(expect.objectContaining({
      code: 'formula-overwrite',
      severity: 'soft',
    }));
    await expect(exportWorkbook(risky)).rejects.toBeInstanceOf(ExportCompatibilityError);

    const reviewed = {
      ...risky,
      reviewedRiskCodes: ['formula-overwrite'],
    };
    await expect(exportWorkbook(reviewed)).resolves.toBeInstanceOf(Blob);
  });

  it('hard-blocks mappings that were not reviewed', async () => {
    const risky = baseInput();
    risky.mappings = [{
      sourceColumnId: 'source_id',
      destinationColumnId: 'target_id',
      confidence: 'medium',
      score: 0.7,
      status: 'review-required',
    }];

    await expect(exportWorkbook(risky)).rejects.toMatchObject({
      risks: expect.arrayContaining([
        expect.objectContaining({ code: 'unreviewed-mapping', severity: 'hard' }),
      ]),
    });
  });

  it('allows an explicitly reviewed mapping to be ignored', async () => {
    const reviewed = baseInput();
    reviewed.mappings = [
      ...reviewed.mappings,
      {
        sourceColumnId: 'source_note',
        destinationColumnId: null,
        confidence: 'low',
        score: 0,
        status: 'accepted',
      },
    ];

    await expect(exportWorkbook(reviewed)).resolves.toBeInstanceOf(Blob);
  });

  it('blocks an empty mapping set and a planned source field without one accepted mapping', async () => {
    const empty = baseInput();
    empty.mappings = [];
    await expect(exportWorkbook(empty)).rejects.toMatchObject({
      risks: expect.arrayContaining([
        expect.objectContaining({ code: 'empty-mappings', severity: 'hard' }),
      ]),
    });

    const partial = baseInput();
    partial.mappings = partial.mappings.filter(({ sourceColumnId }) => sourceColumnId === 'source_id');
    await expect(exportWorkbook(partial)).rejects.toMatchObject({
      risks: expect.arrayContaining([
        expect.objectContaining({ code: 'missing-planned-source-mapping', severity: 'hard' }),
      ]),
    });
  });

  it('detects formula risk in a row that will be cloned from the template', async () => {
    const inputWithFutureRow = baseInput({
      range: 'A2:E5',
      tablePath: undefined,
      definedName: { name: 'DestinoPrincipal', localSheetId: null },
      columns: [{ id: 'target_product', column: 'E' }],
    });
    inputWithFutureRow.mappings = [{
      sourceColumnId: 'source_product',
      destinationColumnId: 'target_product',
      confidence: 'exact',
      score: 1,
      status: 'accepted',
    }];
    inputWithFutureRow.writePlan.inserts[0].destinationRow = 7;

    const risks = await scanExportRisks(inputWithFutureRow);

    expect(risks).toContainEqual(expect.objectContaining({
      code: 'formula-overwrite',
      severity: 'soft',
    }));
  });

  it('hard-blocks query-backed tables and related query-table parts', async () => {
    pkg.updatePart(
      'xl/tables/table1.xml',
      textPart('xl/tables/table1.xml').replace(
        '<table ',
        '<table tableType="queryTable" ',
      ),
    );
    pkg.addPart('xl/queryTables/queryTable1.xml', '<queryTable><queryTableFieldId>1</queryTableFieldId></queryTable>');

    const risks = await scanExportRisks(baseInput());

    expect(risks).toContainEqual(expect.objectContaining({
      code: 'unsupported-query-table',
      severity: 'hard',
    }));
  });

  it('blocks unnamed range expansion and updates an explicitly declared defined name', async () => {
    const unnamed = baseInput({ range: 'A2:E5', tablePath: undefined });
    await expect(exportWorkbook(unnamed)).rejects.toMatchObject({
      risks: expect.arrayContaining([
        expect.objectContaining({ code: 'named-range-expansion-unsupported', severity: 'hard' }),
      ]),
    });

    const named = baseInput({
      range: 'A2:E5',
      tablePath: undefined,
      definedName: { name: 'DestinoPrincipal', localSheetId: null },
    });
    const output = await exportWorkbook(named);
    const exported = await openOoxmlPackage(await output.arrayBuffer());

    expect(new TextDecoder().decode(exported.readPart('xl/workbook.xml'))).toContain(
      "<definedName name=\"DestinoPrincipal\">'Dados Modelo'!$A$2:$E$6</definedName>",
    );
  });

  it('hard-blocks XML 1.0 forbidden control characters before export', async () => {
    const unsafe = baseInput();
    unsafe.writePlan.inserts[0].values.source_product = 'Produto\u0000inválido';

    await expect(exportWorkbook(unsafe)).rejects.toMatchObject({
      risks: expect.arrayContaining([
        expect.objectContaining({ code: 'forbidden-xml-character', severity: 'hard' }),
      ]),
    });
  });

  it('reports invalid destination geometry as an export compatibility risk', async () => {
    const invalid = baseInput({ dataStartRow: 6 });

    expect(await scanExportRisks(invalid)).toContainEqual(expect.objectContaining({
      code: 'invalid-destination-geometry',
      severity: 'hard',
    }));

    await expect(exportWorkbook(invalid)).rejects.toMatchObject({
      risks: expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-destination-geometry', severity: 'hard' }),
      ]),
    });
  });

  it('hard-blocks planned writes beyond the Excel row limit', async () => {
    const invalid = baseInput();
    invalid.writePlan.inserts[0].destinationRow = 1_048_577;

    expect(await scanExportRisks(invalid)).toContainEqual(expect.objectContaining({
      code: 'write-row-exceeds-excel-limit',
      severity: 'hard',
    }));
  });

  it('updates only the selected defined name scope when names collide', async () => {
    pkg.updatePart(
      'xl/workbook.xml',
      textPart('xl/workbook.xml').replace(
        '</definedNames>',
        '<definedName name="DestinoPrincipal" localSheetId="0">\'Dados Modelo\'!$A$2:$E$5</definedName></definedNames>',
      ),
    );
    const scoped = baseInput({
      range: 'A2:E5',
      tablePath: undefined,
      definedName: { name: 'DestinoPrincipal', localSheetId: 0 },
    });

    const output = await exportWorkbook(scoped);
    const exported = await openOoxmlPackage(await output.arrayBuffer());
    const workbook = new TextDecoder().decode(exported.readPart('xl/workbook.xml'));

    expect(workbook).toContain('<definedName name="DestinoPrincipal">\'Dados Modelo\'!$A$2:$E$5</definedName>');
    expect(workbook).toContain('<definedName name="DestinoPrincipal" localSheetId="0">\'Dados Modelo\'!$A$2:$E$6</definedName>');
  });
});

function baseInput(destination: Partial<ExportInput['destination']> = {}): ExportInput {
  const writePlan: WritePlan = {
    mode: 'append',
    headerRow: 2,
    clears: [],
    inserts: [{
      incomingRowId: 'new-1',
      destinationRow: 6,
      values: { source_id: 4, source_product: 'Mochila' },
    }],
    updates: [],
    kept: [],
    duplicates: [],
    rejected: [],
    assignments: [{ kind: 'insert', incomingRowId: 'new-1', destinationRow: 6 }],
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
      ],
      ...destination,
    },
    mappings: [
      {
        sourceColumnId: 'source_id',
        destinationColumnId: 'target_id',
        confidence: 'exact',
        score: 1,
        status: 'accepted',
      },
      {
        sourceColumnId: 'source_product',
        destinationColumnId: 'target_product',
        confidence: 'exact',
        score: 1,
        status: 'accepted',
      },
    ],
    writePlan,
    validationResult: { isValid: true, issues: [] },
  };
}

function textPart(path: string): string {
  return new TextDecoder().decode(pkg.readPart(path));
}
