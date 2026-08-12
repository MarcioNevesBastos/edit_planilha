import type { CellValue } from '../dataset/types';

export type ValidationValueType = 'string' | 'number' | 'date' | 'boolean';

export type ValidationSeverity = 'error' | 'warning';

export type MatrixCondition =
  | { operator: 'equals'; value: CellValue }
  | { operator: 'empty' }
  | { operator: 'any' };

export type ConditionalConstraint =
  | { type: 'required' }
  | { type: 'type'; valueType: ValidationValueType }
  | { type: 'allowed'; allowedValues: readonly CellValue[] }
  | { type: 'numberRange'; min?: number; max?: number }
  | { type: 'dateRange'; min?: string; max?: string }
  | { type: 'stringLength'; min?: number; max?: number }
  | { type: 'equals'; value: CellValue }
  | { type: 'empty' }
  | { type: 'any' }
  | { type: 'unique' }
  | { type: 'compositeUnique'; columnIds: readonly string[] };

export interface ConditionalMatrixEntry {
  conditions: Readonly<Record<string, MatrixCondition>>;
  constraints: Readonly<Record<string, ConditionalConstraint>>;
}

export interface ConditionalMatrixRule {
  type: 'conditionalMatrix';
  id?: string;
  keyColumnIds: readonly string[];
  dependentColumnIds: readonly string[];
  entries: readonly ConditionalMatrixEntry[];
}

export type ValidationRule =
  | { type: 'required'; columnId: string }
  | { type: 'type'; columnId: string; valueType: ValidationValueType }
  | { type: 'allowed'; columnId: string; allowedValues: readonly CellValue[] }
  | { type: 'numberRange'; columnId: string; min?: number; max?: number }
  | { type: 'dateRange'; columnId: string; min?: string; max?: string }
  | { type: 'stringLength'; columnId: string; min?: number; max?: number }
  | { type: 'unique'; columnId: string }
  | { type: 'compositeUnique'; columnIds: readonly string[] }
  | ConditionalMatrixRule;

export interface ValidationIssue {
  rowId: string;
  sourceRowNumber: number;
  columnId: string;
  code: string;
  value: CellValue;
  message: string;
  severity?: ValidationSeverity;
}

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
}
