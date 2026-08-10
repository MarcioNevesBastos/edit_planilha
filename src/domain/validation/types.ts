import type { CellValue } from '../dataset/types';

export type ValidationValueType = 'string' | 'number' | 'date' | 'boolean';

export type ValidationRule =
  | { type: 'required'; columnId: string }
  | { type: 'type'; columnId: string; valueType: ValidationValueType }
  | { type: 'allowed'; columnId: string; allowedValues: readonly CellValue[] }
  | { type: 'numberRange'; columnId: string; min?: number; max?: number }
  | { type: 'dateRange'; columnId: string; min?: string; max?: string }
  | { type: 'stringLength'; columnId: string; min?: number; max?: number }
  | { type: 'unique'; columnId: string }
  | { type: 'compositeUnique'; columnIds: readonly string[] };

export interface ValidationIssue {
  rowId: string;
  sourceRowNumber: number;
  columnId: string;
  code: string;
  value: CellValue;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
}
