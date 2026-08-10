import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { openOoxmlPackage } from '../../../src/io/template/ooxml-package';

const fixtureUrl = new URL(
  '../../../src/test-fixtures/workbooks/template-structured.xlsx',
  import.meta.url,
);
const manifestUrl = new URL(
  '../../../src/test-fixtures/workbooks/template-structured.parts.sha256',
  import.meta.url,
);

async function fixtureBuffer(): Promise<ArrayBuffer> {
  const content = await readFile(fixtureUrl);
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function expectedPartHashes(): Promise<Map<string, string>> {
  const manifest = await readFile(manifestUrl, 'utf8');
  return new Map(manifest.trim().split('\n').map((line) => {
    const [hash, path] = line.split(/\s{2}/, 2);
    return [path, hash];
  }));
}

describe('OOXML package', () => {
  it('round-trips every decompressed ZIP part byte-identically', async () => {
    const original = await openOoxmlPackage(await fixtureBuffer());
    const expectedHashes = await expectedPartHashes();

    expect(original.listParts()).toEqual([...expectedHashes.keys()].sort());
    for (const [path, expectedHash] of expectedHashes) {
      expect(sha256(original.readPart(path)), path).toBe(expectedHash);
    }

    const roundTripped = await openOoxmlPackage(await original.emit());
    expect(roundTripped.listParts()).toEqual(original.listParts());
    for (const path of original.listParts()) {
      expect(roundTripped.readPart(path), path).toEqual(original.readPart(path));
    }
  });

  it('exposes explicit read, update, add, and remove operations', async () => {
    const pkg = await openOoxmlPackage(await fixtureBuffer());
    const originalWorkbook = pkg.readPart('xl/workbook.xml');

    pkg.updatePart('customXml/item1.xml', '<updated/>');
    pkg.addPart('customXml/new-item.xml', '<new/>');
    pkg.removePart('docProps/app.xml');

    const reopened = await openOoxmlPackage(await pkg.emit());
    expect(new TextDecoder().decode(reopened.readPart('customXml/item1.xml'))).toBe('<updated/>');
    expect(new TextDecoder().decode(reopened.readPart('customXml/new-item.xml'))).toBe('<new/>');
    expect(reopened.hasPart('docProps/app.xml')).toBe(false);
    expect(reopened.readPart('xl/workbook.xml')).toEqual(originalWorkbook);
  });

  it('contains all preservation-sensitive workbook features', async () => {
    const pkg = await openOoxmlPackage(await fixtureBuffer());
    const worksheet = new TextDecoder().decode(pkg.readPart('xl/worksheets/sheet1.xml'));

    expect(pkg.hasPart('xl/styles.xml')).toBe(true);
    expect(pkg.hasPart('xl/tables/table1.xml')).toBe(true);
    expect(pkg.hasPart('xl/charts/chart1.xml')).toBe(true);
    expect(pkg.hasPart('xl/media/image1.png')).toBe(true);
    expect(worksheet).toContain('<f>C3*D3</f>');
    expect(worksheet).toContain('<dataValidations');
    expect(worksheet).toContain('<mergeCells');
    expect(worksheet).toContain('<autoFilter');
    expect(worksheet).toContain('state="frozen"');
  });
});
