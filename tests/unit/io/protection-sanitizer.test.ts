import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { openOoxmlPackage } from '../../../src/io/template/ooxml-package';
import { indexWorkbook } from '../../../src/io/template/workbook-index';
import { preparePackageForExport } from '../../../src/io/template/protection-sanitizer';

const fixtureUrl = new URL(
  '../../../src/test-fixtures/workbooks/template-structured.xlsx',
  import.meta.url,
);

async function fixtureBuffer(): Promise<ArrayBuffer> {
  const content = await readFile(fixtureUrl);
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
}

function decode(content: Uint8Array): string {
  return new TextDecoder().decode(content);
}

describe('protection sanitizer', () => {
  it('removes workbook and worksheet protection from an export copy', async () => {
    const source = await openOoxmlPackage(await fixtureBuffer());
    source.updatePart(
      'xl/workbook.xml',
      decode(source.readPart('xl/workbook.xml')).replace(
        '<sheets>',
        '<workbookProtection workbookPassword="ABCD" lockStructure="1"/><sheets>',
      ),
    );
    for (const path of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
      source.updatePart(
        path,
        decode(source.readPart(path)).replace(
          '<sheetData>',
          '<sheetProtection sheet="1"/><sheetData>',
        ),
      );
    }

    const prepared = await preparePackageForExport(source);
    const preparedIndex = await indexWorkbook(prepared);

    expect(preparedIndex.workbookProtected).toBe(false);
    expect(preparedIndex.sheets.every((sheet) => !sheet.protected)).toBe(true);
    expect(decode(prepared.readPart(preparedIndex.workbookPath))).not.toContain('workbookProtection');
    for (const sheet of preparedIndex.sheets) {
      expect(decode(prepared.readPart(sheet.path))).not.toContain('sheetProtection');
    }
  });

  it('does not mutate the source and preserves unrelated XML', async () => {
    const source = await openOoxmlPackage(await fixtureBuffer());
    const originalWorkbook = decode(source.readPart('xl/workbook.xml'));
    const originalSheet = decode(source.readPart('xl/worksheets/sheet1.xml'));
    source.updatePart(
      'xl/workbook.xml',
      originalWorkbook.replace(
        '<sheets>',
        '<workbookProtection lockStructure="1"/><sheets>',
      ),
    );
    source.updatePart(
      'xl/worksheets/sheet1.xml',
      originalSheet.replace('<sheetData>', '<sheetProtection sheet="1"/><sheetData>'),
    );

    const prepared = await preparePackageForExport(source);

    expect(decode(source.readPart('xl/workbook.xml'))).toContain('workbookProtection');
    expect(decode(source.readPart('xl/worksheets/sheet1.xml'))).toContain('sheetProtection');
    expect(decode(prepared.readPart('xl/worksheets/sheet1.xml'))).toContain('<f>C3*D3</f>');
    expect(prepared.hasPart('xl/media/image1.png')).toBe(true);
  });
});
