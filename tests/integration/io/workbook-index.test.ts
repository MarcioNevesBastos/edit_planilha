import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  manualDestinationSelectionAction,
  detectDestination,
} from '../../../src/io/template/destination-detector';
import { openOoxmlPackage } from '../../../src/io/template/ooxml-package';
import { indexWorkbook, type WorkbookIndex } from '../../../src/io/template/workbook-index';

const fixtureUrl = new URL(
  '../../../src/test-fixtures/workbooks/template-structured.xlsx',
  import.meta.url,
);

let index: WorkbookIndex;

beforeAll(async () => {
  const content = await readFile(fixtureUrl);
  const buffer = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
  index = await indexWorkbook(await openOoxmlPackage(buffer));
});

describe('workbook index', () => {
  it('indexes sheet order, workbook relationships, and worksheet targets', () => {
    expect(index.workbookPath).toBe('xl/workbook.xml');
    expect(index.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'rId1',
        target: 'worksheets/sheet1.xml',
        targetPath: 'xl/worksheets/sheet1.xml',
      }),
      expect.objectContaining({
        id: 'rId2',
        target: 'worksheets/sheet2.xml',
        targetPath: 'xl/worksheets/sheet2.xml',
      }),
    ]));
    expect(index.sheets.map((sheet) => ({
      name: sheet.name,
      order: sheet.order,
      relationshipId: sheet.relationshipId,
      path: sheet.path,
    }))).toEqual([
      {
        name: 'Dados Modelo',
        order: 0,
        relationshipId: 'rId1',
        path: 'xl/worksheets/sheet1.xml',
      },
      {
        name: 'Protegida',
        order: 1,
        relationshipId: 'rId2',
        path: 'xl/worksheets/sheet2.xml',
      },
    ]);
  });

  it('indexes defined names, tables, used ranges, and protection indicators', () => {
    expect(index.definedNames).toEqual([
      {
        name: 'DestinoPrincipal',
        formula: "'Dados Modelo'!$A$2:$E$5",
        localSheetId: null,
        hidden: false,
        sheetName: 'Dados Modelo',
        range: 'A2:E5',
      },
      {
        name: 'EntradaProtegida',
        formula: 'Protegida!$A$1:$C$4',
        localSheetId: 1,
        hidden: false,
        sheetName: 'Protegida',
        range: 'A1:C4',
      },
    ]);

    expect(index.sheets[0]).toMatchObject({
      usedRange: 'A1:F6',
      protected: false,
      tables: [{
        id: 1,
        name: 'TabelaDestino',
        displayName: 'TabelaDestino',
        range: 'A2:D5',
        autoFilterRange: 'A2:D5',
        relationshipId: 'rId1',
        path: 'xl/tables/table1.xml',
      }],
      detectedRegions: [{ range: 'A2:E6', headerRow: 2, dataRowCount: 4 }],
    });
    expect(index.sheets[1]).toMatchObject({
      usedRange: 'A1:C4',
      protected: true,
      tables: [],
      detectedRegions: [{ range: 'A1:C4', headerRow: 1, dataRowCount: 3 }],
    });
  });
});

describe('destination detector', () => {
  it('orders table, named-range, then detected-region candidates', () => {
    expect(detectDestination(index, 'Dados Modelo')).toEqual([
      {
        kind: 'table',
        sheetName: 'Dados Modelo',
        range: 'A2:D5',
        confidence: 'high',
        explanation: 'Excel table "TabelaDestino" defines a structured destination.',
        tableName: 'TabelaDestino',
      },
      {
        kind: 'named-range',
        sheetName: 'Dados Modelo',
        range: 'A2:E5',
        confidence: 'high',
        explanation: 'Defined name "DestinoPrincipal" identifies this destination range.',
        definedName: 'DestinoPrincipal',
      },
      {
        kind: 'detected-region',
        sheetName: 'Dados Modelo',
        range: 'A2:E6',
        confidence: 'medium',
        explanation: 'A contiguous header and data region was detected automatically.',
      },
    ]);
  });

  it('keeps manual selection as a UI action, never an automatic candidate', () => {
    expect(manualDestinationSelectionAction).toEqual({
      kind: 'manual-selection',
      label: 'Select a range manually',
    });
    expect(detectDestination(index, 'missing')).toEqual([]);
    expect(detectDestination(index, 'Dados Modelo').some(
      (candidate) => String(candidate.kind) === 'manual-selection',
    )).toBe(false);
  });
});
