import type { CellValue, DatasetColumn } from '../dataset/types';

export type Expression =
  | { type: 'literal'; value: CellValue }
  | { type: 'column'; columnId: string }
  | { type: 'unary'; operator: 'not' | 'negate'; operand: Expression }
  | {
    type: 'binary';
    operator: '+' | '-' | '*' | '/' | '==' | '!=' | '>' | '>=' | '<' | '<=' | 'and' | 'or';
    left: Expression;
    right: Expression;
  };

export type TransformConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'isEmpty'
  | 'notEmpty'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual';

export type TransformConditionOperand =
  | { type: 'literal'; value: CellValue }
  | { type: 'column'; columnId: string };

export type TransformConditionNode =
  | {
    type: 'predicate';
    columnId: string;
    operator: TransformConditionOperator;
    operand?: TransformConditionOperand;
  }
  | {
    type: 'group';
    operator: 'and' | 'or';
    children: TransformConditionNode[];
  };

export type ColumnDefinition = Pick<DatasetColumn, 'id' | 'header'> & {
  detectedType?: DatasetColumn['detectedType'];
};

export type FilterOperator =
  | 'equals'
  | 'contains'
  | 'isEmpty'
  | 'notEmpty'
  | 'greaterThan'
  | 'lessThan';

export type TransformCommand =
  | { type: 'reorderColumns'; columnIds: string[] }
  | { type: 'sort'; sorts: Array<{ columnId: string; direction: 'asc' | 'desc' }> }
  | { type: 'filter'; columnId: string; operator: FilterOperator; value?: CellValue }
  | { type: 'removeEmptyRows'; columnIds?: string[] }
  | { type: 'deduplicate'; columnIds: string[]; keep: 'first' | 'last' }
  | { type: 'renameHeader'; columnId: string; header: string }
  | { type: 'splitColumn'; columnId: string; delimiter: string; newColumns: ColumnDefinition[]; when?: TransformConditionNode }
  | { type: 'combineColumns'; columnIds: string[]; separator: string; newColumn: ColumnDefinition; when?: TransformConditionNode }
  | { type: 'findReplace'; columnIds: string[]; find: CellValue; replace: CellValue; caseSensitive?: boolean; when?: TransformConditionNode }
  | { type: 'dateConversion'; columnId: string; inputFormat: 'auto' | 'dd/MM/yyyy' | 'yyyy-MM-dd'; outputFormat: 'dd/MM/yyyy' | 'yyyy-MM-dd'; when?: TransformConditionNode }
  | { type: 'numberConversion'; columnId: string; decimalSeparator: '.' | ','; when?: TransformConditionNode }
  | { type: 'currencyConversion'; columnId: string; locale: string; currency: string; when?: TransformConditionNode }
  | { type: 'prefix'; columnId: string; value: string; when?: TransformConditionNode }
  | { type: 'suffix'; columnId: string; value: string; when?: TransformConditionNode }
  | { type: 'fixedValue'; columnId: string; value: CellValue; when?: TransformConditionNode }
  | { type: 'calculatedColumn'; newColumn: ColumnDefinition; expression: Expression; when?: TransformConditionNode }
  | { type: 'conditionalRule'; condition: TransformConditionNode; updates: Array<{ columnId: string; value: CellValue }> }
  | { type: 'editCell'; rowId: string; columnId: string; value: CellValue };
