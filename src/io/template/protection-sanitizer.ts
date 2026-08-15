import { openOoxmlPackage, type OoxmlPackage } from './ooxml-package';
import { indexWorkbook } from './workbook-index';

const decoder = new TextDecoder();

export async function preparePackageForExport(source: OoxmlPackage): Promise<OoxmlPackage> {
  const prepared = await openOoxmlPackage(await source.emit());
  const index = await indexWorkbook(prepared);

  updateWithoutProtection(prepared, index.workbookPath, 'workbookProtection');
  for (const sheet of index.sheets) {
    updateWithoutProtection(prepared, sheet.path, 'sheetProtection');
  }

  return prepared;
}

function updateWithoutProtection(pkg: OoxmlPackage, path: string, tagName: string): void {
  const original = decoder.decode(pkg.readPart(path));
  const sanitized = removeXmlElements(original, tagName);
  if (sanitized !== original) {
    pkg.updatePart(path, sanitized);
  }
}

function removeXmlElements(xml: string, tagName: string): string {
  const pattern = new RegExp(`<${tagName}\\b[^>]*(?:/>|>[\\s\\S]*?<\\/${tagName}>)`, 'g');
  return xml.replace(pattern, '');
}
