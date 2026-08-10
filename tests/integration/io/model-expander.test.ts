import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it } from 'vitest';
import { expandDestination } from '../../../src/io/template/model-expander';
import { openOoxmlPackage, type OoxmlPackage } from '../../../src/io/template/ooxml-package';
import { addRejectedSheet } from '../../../src/io/template/rejected-sheet';
import { indexWorkbook } from '../../../src/io/template/workbook-index';

const fixtureUrl = new URL(
  '../../../src/test-fixtures/workbooks/template-structured.xlsx',
  import.meta.url,
);

let pkg: OoxmlPackage;

beforeEach(async () => {
  const content = await readFile(fixtureUrl);
  pkg = await openOoxmlPackage(
    content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
  );
});

describe('expandDestination', () => {
  it('expands table ranges, inserts only required model rows, and preserves unrelated parts', async () => {
    const untouched = new Map(
      ['xl/drawings/drawing1.xml', 'xl/charts/chart1.xml', 'xl/media/image1.png']
        .map((path) => [path, pkg.readPart(path)]),
    );

    await expandDestination(pkg, {
      worksheetPath: 'xl/worksheets/sheet1.xml',
      destinationRange: 'A2:D5',
      dataStartRow: 3,
      templateRow: 5,
      requiredDataRows: 5,
      tablePath: 'xl/tables/table1.xml',
    });

    const worksheet = textPart('xl/worksheets/sheet1.xml');
    const table = textPart('xl/tables/table1.xml');
    expect(table).toContain('ref="A2:D7"');
    expect(table).toContain('<autoFilter ref="A2:D7"/>');
    expect(worksheet).toContain('<dimension ref="A1:F8"/>');
    expect(worksheet).toContain('<autoFilter ref="A2:E7"/>');
    expect(worksheet).toContain('<row r="6"><c r="A6"');
    expect(worksheet).toContain('<c r="E6" s="2"><f>C6*D6</f>');
    expect(worksheet).toContain('<row r="7"><c r="A7"');
    expect(worksheet).toContain('<c r="E7" s="2"><f>C7*D7</f>');
    expect(worksheet).toContain('<row r="8"><c r="D8" s="1"');
    expect(worksheet).toContain('<c r="E8" s="2"><f>SUM(E5:E7)</f>');
    expect(worksheet.match(/<row r="[67]"/g)).toHaveLength(2);

    for (const [path, original] of untouched) {
      expect(pkg.readPart(path), path).toEqual(original);
    }
  });

  it('expands an ordinary range with styles, shifted formulas, and validation coverage', async () => {
    pkg.updatePart(
      'xl/worksheets/sheet2.xml',
      textPart('xl/worksheets/sheet2.xml')
        .replace('<row r="4"><c r="A4">', '<row r="4" ht="20"><c r="A4" s="3">')
        .replace(
          '<c r="C4" t="b"><v>1</v></c>',
          '<c r="C4" s="4"><f>A4+1</f><v>13</v></c>',
        )
        .replace(
          '<pageMargins',
          '<autoFilter ref="Z10:Z12"/><dataValidations count="2"><dataValidation type="whole" sqref="A2:A4"><formula1>0</formula1></dataValidation><dataValidation type="whole" sqref="Z10:Z12"><formula1>0</formula1></dataValidation></dataValidations><pageMargins',
        ),
    );

    await expandDestination(pkg, {
      worksheetPath: 'xl/worksheets/sheet2.xml',
      destinationRange: 'A2:C4',
      dataStartRow: 2,
      templateRow: 4,
      requiredDataRows: 5,
    });

    const worksheet = textPart('xl/worksheets/sheet2.xml');
    expect(worksheet).toContain('<dimension ref="A1:C6"/>');
    expect(worksheet).toContain('<row r="5" ht="20"><c r="A5" s="3">');
    expect(worksheet).toContain('<c r="C5" s="4"><f>A5+1</f>');
    expect(worksheet).toContain('<row r="6" ht="20"><c r="A6" s="3">');
    expect(worksheet).toContain('<c r="C6" s="4"><f>A6+1</f>');
    expect(worksheet).toContain('sqref="A2:A6"');
    expect(worksheet).toContain('sqref="Z12:Z14"');
    expect(worksheet).toContain('<autoFilter ref="Z12:Z14"/>');
  });

  it('rejects a template row outside the confirmed destination model', async () => {
    await expect(expandDestination(pkg, {
      worksheetPath: 'xl/worksheets/sheet2.xml',
      destinationRange: 'A2:C4',
      dataStartRow: 2,
      templateRow: 1,
      requiredDataRows: 5,
    })).rejects.toThrow('Template row 1 is outside destination data rows 2:4');
  });

  it('does not mutate the worksheet when its table range is not the confirmed destination', async () => {
    const originalWorksheet = pkg.readPart('xl/worksheets/sheet1.xml');
    const originalTable = pkg.readPart('xl/tables/table1.xml');

    await expect(expandDestination(pkg, {
      worksheetPath: 'xl/worksheets/sheet1.xml',
      destinationRange: 'A2:E5',
      dataStartRow: 3,
      templateRow: 5,
      requiredDataRows: 5,
      tablePath: 'xl/tables/table1.xml',
    })).rejects.toThrow('Table range A2:D5 does not match destination A2:E5');

    expect(pkg.readPart('xl/worksheets/sheet1.xml')).toEqual(originalWorksheet);
    expect(pkg.readPart('xl/tables/table1.xml')).toEqual(originalTable);
  });
});

describe('addRejectedSheet', () => {
  it('adds a related worksheet with rejection details and preserves unrelated parts', async () => {
    const originalWorksheet = pkg.readPart('xl/worksheets/sheet1.xml');
    const originalDrawing = pkg.readPart('xl/drawings/drawing1.xml');

    const name = await addRejectedSheet(pkg, [{
      sourceRowNumber: 9,
      originalRelevantFields: {
        Cliente: 'Ana & Bia',
        Idade: 17,
      },
      errorField: 'Idade',
      invalidValue: 17,
      rejectionReason: 'Deve ser >= 18',
      failedRuleOrTransform: 'min:18',
    }]);

    expect(name).toBe('Registros rejeitados');
    expect(pkg.hasPart('xl/worksheets/sheet3.xml')).toBe(true);
    expect(textPart('xl/workbook.xml')).toContain(
      '<sheet name="Registros rejeitados" sheetId="3" r:id="rId4"/>',
    );
    expect(textPart('xl/_rels/workbook.xml.rels')).toContain(
      'Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"',
    );
    expect(textPart('[Content_Types].xml')).toContain(
      'PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"',
    );

    const worksheet = textPart('xl/worksheets/sheet3.xml');
    expect(worksheet).toContain('<dimension ref="A1:G2"/>');
    for (const header of [
      'source row number',
      'Cliente',
      'Idade',
      'error field',
      'invalid value',
      'rejection reason',
      'failed rule/transform',
    ]) {
      expect(worksheet).toContain(`<t>${header}</t>`);
    }
    expect(worksheet).toContain('<c r="A2"><v>9</v></c>');
    expect(worksheet).toContain('<t>Ana &amp; Bia</t>');
    expect(worksheet).toContain('<c r="C2"><v>17</v></c>');
    expect(worksheet).toContain('<t>Deve ser &gt;= 18</t>');

    const index = await indexWorkbook(pkg);
    expect(index.sheets.at(-1)).toMatchObject({
      name: 'Registros rejeitados',
      relationshipId: 'rId4',
      path: 'xl/worksheets/sheet3.xml',
    });
    expect(pkg.readPart('xl/worksheets/sheet1.xml')).toEqual(originalWorksheet);
    expect(pkg.readPart('xl/drawings/drawing1.xml')).toEqual(originalDrawing);
  });

  it('returns a numbered legal name when the rejected sheet already exists', async () => {
    expect(await addRejectedSheet(pkg, [])).toBe('Registros rejeitados');
    expect(await addRejectedSheet(pkg, [])).toBe('Registros rejeitados (2)');

    const index = await indexWorkbook(pkg);
    expect(index.sheets.slice(-2).map(({ name }) => name)).toEqual([
      'Registros rejeitados',
      'Registros rejeitados (2)',
    ]);
  });

  it('does not partially mutate the package when required relationship XML is invalid', async () => {
    pkg.updatePart('[Content_Types].xml', '<Types>');
    const originalParts = pkg.listParts();
    const originalWorkbook = pkg.readPart('xl/workbook.xml');
    const originalRelationships = pkg.readPart('xl/_rels/workbook.xml.rels');

    await expect(addRejectedSheet(pkg, [])).rejects.toThrow(
      'Invalid OOXML: missing </Types>',
    );

    expect(pkg.listParts()).toEqual(originalParts);
    expect(pkg.readPart('xl/workbook.xml')).toEqual(originalWorkbook);
    expect(pkg.readPart('xl/_rels/workbook.xml.rels')).toEqual(originalRelationships);
  });
});

function textPart(path: string): string {
  return new TextDecoder().decode(pkg.readPart(path));
}
