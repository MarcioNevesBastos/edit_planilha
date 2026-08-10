export type CellValue = string | number | boolean | null;

export interface DatasetColumn {
  id: string;
  header: string;
  sourceIndex: number;
  detectedType: 'string' | 'number' | 'date' | 'boolean' | 'mixed' | 'empty';
}

export interface DataRow {
  rowId: string;
  sourceRowNumber: number;
  values: Record<string, CellValue>;
  originalValues: Record<string, CellValue>;
}

export interface Dataset {
  columns: DatasetColumn[];
  rows: DataRow[];
}
