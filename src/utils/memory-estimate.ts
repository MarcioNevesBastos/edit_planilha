import type { CellValue, Dataset } from '../domain/dataset/types';

export type DatasetMemoryRisk = 'safe' | 'warning' | 'high-risk';

export interface MemoryAdvisoryOptions {
  sessionThresholdBytes: number;
}

export interface DatasetMemoryAdvisory {
  estimatedBytes: number;
  sessionThresholdBytes: number;
  risk: DatasetMemoryRisk;
}

export function estimateDatasetBytes(dataset: Dataset): number {
  let bytes = 0;

  for (const column of dataset.columns) {
    bytes += stringBytes(column.id) + stringBytes(column.header) + 16;
  }

  for (const row of dataset.rows) {
    bytes += stringBytes(row.rowId) + 8;
    bytes += recordBytes(row.values);
    bytes += recordBytes(row.originalValues);
  }

  return bytes;
}

export function classifyDatasetMemory(
  estimatedBytes: number,
  { sessionThresholdBytes }: MemoryAdvisoryOptions,
): DatasetMemoryRisk {
  if (sessionThresholdBytes <= 0) {
    throw new RangeError('sessionThresholdBytes deve ser maior que zero.');
  }

  if (estimatedBytes <= sessionThresholdBytes) {
    return 'safe';
  }

  return estimatedBytes < sessionThresholdBytes * 2 ? 'warning' : 'high-risk';
}

export function getDatasetMemoryAdvisory(
  dataset: Dataset,
  options: MemoryAdvisoryOptions,
): DatasetMemoryAdvisory {
  const estimatedBytes = estimateDatasetBytes(dataset);

  return {
    estimatedBytes,
    sessionThresholdBytes: options.sessionThresholdBytes,
    risk: classifyDatasetMemory(estimatedBytes, options),
  };
}

function recordBytes(values: Record<string, CellValue>): number {
  return Object.entries(values)
    .reduce((total, [key, value]) => total + stringBytes(key) + cellValueBytes(value) + 8, 0);
}

function cellValueBytes(value: CellValue): number {
  if (typeof value === 'string') {
    return stringBytes(value);
  }

  return typeof value === 'number' ? 8 : typeof value === 'boolean' ? 4 : 0;
}

function stringBytes(value: string): number {
  return value.length * 2;
}
