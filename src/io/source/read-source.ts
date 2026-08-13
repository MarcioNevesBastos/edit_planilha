import type { Dataset } from '../../domain/dataset/types';
import { readCsv } from './read-csv';
import { SourceReadError, type ReadSourceOptions } from './types';

export { SourceReadError, type ReadSourceOptions, type SourceReadIssue } from './types';

export async function listSourceSheets(file: File): Promise<string[]> {
  if (extensionOf(file.name) === 'csv') {
    return [];
  }

  if (extensionOf(file.name) === 'xlsx') {
    const { listXlsxSheets } = await import('./read-xlsx');
    return listXlsxSheets(file);
  }

  throw unsupportedFileError(file);
}

export async function readSource(file: File, options: ReadSourceOptions = {}): Promise<Dataset> {
  if (extensionOf(file.name) === 'csv') {
    return readCsv(file, options);
  }

  if (extensionOf(file.name) === 'xlsx') {
    const { readXlsx } = await import('./read-xlsx');
    return readXlsx(file, options);
  }

  throw unsupportedFileError(file);
}

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function unsupportedFileError(file: File): SourceReadError {
  return new SourceReadError([{
    code: 'UnsupportedFileType',
    message: `Tipo de arquivo de origem não suportado: ${file.name}`,
  }]);
}
