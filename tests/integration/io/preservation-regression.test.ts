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
      columns: [{ id: 'target_product', column: 'E' }],
    });
    risky.mappings = [{
      sourceColumnId: 'source_product',
      destinationColumnId: 'target_product',
      confidence: 'exact',
      score: 1,
      status: 'accepted',
    }];

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
