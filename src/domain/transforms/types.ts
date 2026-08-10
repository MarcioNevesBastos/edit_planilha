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
  | { type: 'splitColumn'; columnId: string; delimiter: string; newColumns: ColumnDefinition[] }
  | { type: 'combineColumns'; columnIds: string[]; separator: string; newColumn: ColumnDefinition }
  | { type: 'findReplace'; columnIds: string[]; find: string; replace: string; caseSensitive?: boolean }
  | { type: 'dateConversion'; columnId: string; inputFormat: 'auto' | 'dd/MM/yyyy' | 'yyyy-MM-dd'; outputFormat: 'dd/MM/yyyy' | 'yyyy-MM-dd' }
  | { type: 'numberConversion'; columnId: string; decimalSeparator: '.' | ',' }
  | { type: 'currencyConversion'; columnId: string; locale: string; currency: string }
  | { type: 'prefix'; columnId: string; value: string }
  | { type: 'suffix'; columnId: string; value: string }
  | { type: 'fixedValue'; columnId: string; value: CellValue }
  | { type: 'calculatedColumn'; newColumn: ColumnDefinition; expression: Expression }
  | { type: 'conditionalRule'; condition: Expression; updates: Array<{ columnId: string; value: CellValue }> }
  | { type: 'editCell'; rowId: string; columnId: string; value: CellValue };
