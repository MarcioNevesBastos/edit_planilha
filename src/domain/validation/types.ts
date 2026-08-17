import type { CellValue } from '../dataset/types';
import type { Expression, TransformConditionNode } from '../transforms/types';

export type ValidationValueType = 'string' | 'number' | 'date' | 'boolean';

export type ValidationFormat = 'email' | 'cpf' | 'cnpj' | 'cep' | 'phone' | 'prefix' | 'suffix' | 'regex';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationRuleMetadata {
  id?: string;
  name?: string;
  enabled?: boolean;
  severity?: ValidationSeverity;
  message?: string;
  when?: TransformConditionNode;
}

export type ValidationOperand =
  | { type: 'literal'; value: CellValue }
  | { type: 'column'; columnId: string };

export type ValidationComparisonOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual';

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

export interface ValidationRelationRule extends ValidationRuleMetadata {
  type: 'relation';
  source: string;
  leftColumnIds: readonly string[];
  rightColumnIds: readonly string[];
  minMatches: number;
  maxMatches?: number;
}

export interface ConditionalMatrixRule extends ValidationRuleMetadata {
  type: 'conditionalMatrix';
  id?: string;
  noMatchBehavior?: 'warning' | 'error' | 'ignore';
  keyColumnIds: readonly string[];
  dependentColumnIds: readonly string[];
  entries: readonly ConditionalMatrixEntry[];
}

export type ValidationRule =
  | (ValidationRuleMetadata & { type: 'required'; columnId: string })
  | (ValidationRuleMetadata & { type: 'type'; columnId: string; valueType: ValidationValueType })
  | (ValidationRuleMetadata & { type: 'allowed'; columnId: string; allowedValues: readonly CellValue[] })
  | (ValidationRuleMetadata & { type: 'numberRange'; columnId: string; min?: number; max?: number })
  | (ValidationRuleMetadata & { type: 'dateRange'; columnId: string; min?: string; max?: string })
  | (ValidationRuleMetadata & { type: 'stringLength'; columnId: string; min?: number; max?: number })
  | (ValidationRuleMetadata & { type: 'empty'; columnId: string })
  | (ValidationRuleMetadata & { type: 'integer'; columnId: string })
  | (ValidationRuleMetadata & { type: 'numberPrecision'; columnId: string; decimalPlaces: number })
  | (ValidationRuleMetadata & { type: 'notAllowed'; columnId: string; disallowedValues: readonly CellValue[] })
  | (ValidationRuleMetadata & {
    type: 'format';
    columnId: string;
    format: ValidationFormat;
    pattern?: string;
    prefix?: string;
    suffix?: string;
  })
  | (ValidationRuleMetadata & { type: 'unique'; columnId: string })
  | (ValidationRuleMetadata & { type: 'compositeUnique'; columnIds: readonly string[] })
  | (ValidationRuleMetadata & {
    type: 'comparison';
    left: ValidationOperand;
    operator: ValidationComparisonOperator;
    right: ValidationOperand;
  })
  | (ValidationRuleMetadata & { type: 'expression'; expression: Expression })
  | (ValidationRuleMetadata & { type: 'reference'; columnId: string; referenceColumnId: string; mode: 'exists' | 'notExists' })
  | ValidationRelationRule
  | ConditionalMatrixRule;

export interface ValidationIssue {
  rowId: string;
  sourceRowNumber: number;
  columnId: string;
  code: string;
  value: CellValue;
  message: string;
  ruleId?: string;
  severity?: ValidationSeverity;
}

export interface ValidationConfigurationError {
  ruleId?: string;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  configurationErrors?: ValidationConfigurationError[];
  ruleImpact?: Record<string, { affectedRows: number; affectedCells: number }>;
}
