import type { CellValue, DataRow, Dataset, DatasetColumn } from '../dataset/types';
import type { ColumnDefinition, Expression, FilterOperator, TransformCommand } from './types';

function hasColumn(dataset: Dataset, columnId: string): void {
  if (!dataset.columns.some((column) => column.id === columnId)) {
    throw new RangeError(`Unknown column: ${columnId}`);
  }
}

function assertKnownColumns(dataset: Dataset, columnIds: readonly string[]): void {
  for (const columnId of columnIds) {
    hasColumn(dataset, columnId);
  }
}

function assertNewColumns(dataset: Dataset, columns: readonly ColumnDefinition[]): void {
  const seen = new Set(dataset.columns.map((column) => column.id));
  for (const column of columns) {
    if (seen.has(column.id)) {
      throw new RangeError(`Duplicate column: ${column.id}`);
    }
    seen.add(column.id);
  }
}

function copyDataset(dataset: Dataset, columns = dataset.columns, rows = dataset.rows): Dataset {
  return { columns, rows };
}

function isEmpty(value: CellValue): boolean {
  return value === null || value === '';
}

function toText(value: CellValue): string {
  return value === null ? '' : String(value);
}

function compareValues(left: CellValue, right: CellValue): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function matchesFilter(value: CellValue, operator: FilterOperator, expected?: CellValue): boolean {
  switch (operator) {
    case 'equals': return value === expected;
    case 'contains': return toText(value).includes(toText(expected ?? null));
    case 'isEmpty': return isEmpty(value);
    case 'notEmpty': return !isEmpty(value);
    case 'greaterThan': return value !== null && expected !== null && expected !== undefined && compareValues(value, expected) > 0;
    case 'lessThan': return value !== null && expected !== null && expected !== undefined && compareValues(value, expected) < 0;
  }
}

function appendColumn(dataset: Dataset, column: ColumnDefinition, insertAt = dataset.columns.length): DatasetColumn[] {
  const nextColumn: DatasetColumn = {
    id: column.id,
    header: column.header,
    sourceIndex: Math.max(-1, ...dataset.columns.map((existing) => existing.sourceIndex)) + 1,
    detectedType: column.detectedType ?? 'mixed',
  };
  return [
    ...dataset.columns.slice(0, insertAt),
    nextColumn,
    ...dataset.columns.slice(insertAt),
  ];
}

function replaceValues(dataset: Dataset, update: (row: DataRow) => Record<string, CellValue>): Dataset {
  return copyDataset(dataset, dataset.columns, dataset.rows.map((row) => ({
    ...row,
    values: update(row),
  })));
}

function parseDate(value: CellValue, inputFormat: 'auto' | 'dd/MM/yyyy' | 'yyyy-MM-dd'): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null;
  const patterns = inputFormat === 'auto'
    ? [/^(\d{4})-(\d{2})-(\d{2})$/, /^(\d{2})\/(\d{2})\/(\d{4})$/]
    : inputFormat === 'yyyy-MM-dd'
      ? [/^(\d{4})-(\d{2})-(\d{2})$/]
      : [/^(\d{2})\/(\d{2})\/(\d{4})$/];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const [year, month, day] = pattern.source.startsWith('^(\\d{4})')
      ? [Number(match[1]), Number(match[2]), Number(match[3])]
      : [Number(match[3]), Number(match[2]), Number(match[1])];
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day) {
      return { year, month, day };
    }
  }
  return null;
}

function formatDate(parts: { year: number; month: number; day: number }, outputFormat: 'dd/MM/yyyy' | 'yyyy-MM-dd'): string {
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return outputFormat === 'yyyy-MM-dd' ? `${parts.year}-${month}-${day}` : `${day}/${month}/${parts.year}`;
}

function parseNumber(value: CellValue, decimalSeparator: '.' | ','): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = decimalSeparator === ','
    ? value.replace(/\./g, '').replace(',', '.')
    : value.replace(/,/g, '');
  const parsed = Number(normalized.trim());
  return Number.isFinite(parsed) && normalized.trim() !== '' ? parsed : null;
}

function evaluateExpression(expression: Expression, row: DataRow): CellValue {
  switch (expression.type) {
    case 'literal': return expression.value;
    case 'column': return row.values[expression.columnId] ?? null;
    case 'unary': {
      const operand = evaluateExpression(expression.operand, row);
      return expression.operator === 'not' ? !Boolean(operand) : typeof operand === 'number' ? -operand : null;
    }
    case 'binary': {
      const left = evaluateExpression(expression.left, row);
      const right = evaluateExpression(expression.right, row);
      switch (expression.operator) {
        case '+':
          if (left === null || right === null) return null;
          return typeof left === 'number' && typeof right === 'number' ? left + right : `${toText(left)}${toText(right)}`;
        case '-': return typeof left === 'number' && typeof right === 'number' ? left - right : null;
        case '*': return typeof left === 'number' && typeof right === 'number' ? left * right : null;
        case '/': return typeof left === 'number' && typeof right === 'number' && right !== 0 ? left / right : null;
        case '==': return left === right;
        case '!=': return left !== right;
        case '>': return left !== null && right !== null && compareValues(left, right) > 0;
        case '>=': return left !== null && right !== null && compareValues(left, right) >= 0;
        case '<': return left !== null && right !== null && compareValues(left, right) < 0;
        case '<=': return left !== null && right !== null && compareValues(left, right) <= 0;
        case 'and': return Boolean(left) && Boolean(right);
        case 'or': return Boolean(left) || Boolean(right);
      }
    }
  }
}

function stableKey(values: readonly CellValue[]): string {
  return JSON.stringify(values.map((value) => [typeof value, value]));
}

function replaceLiteral(value: CellValue, find: string, replacement: string, caseSensitive: boolean): CellValue {
  if (typeof value !== 'string' || find === '') return value;
  if (caseSensitive) return value.replaceAll(find, replacement);
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(escaped, 'gi'), replacement);
}

export function applyTransform(dataset: Dataset, command: TransformCommand): Dataset {
  switch (command.type) {
    case 'reorderColumns': {
      assertKnownColumns(dataset, command.columnIds);
      if (command.columnIds.length !== dataset.columns.length || new Set(command.columnIds).size !== dataset.columns.length) {
        throw new RangeError('Column order must contain every column exactly once');
      }
      const columnsById = new Map(dataset.columns.map((column) => [column.id, column]));
      return copyDataset(dataset, command.columnIds.map((columnId) => columnsById.get(columnId)!));
    }
    case 'sort': {
      assertKnownColumns(dataset, command.sorts.map((sort) => sort.columnId));
      return copyDataset(dataset, dataset.columns, dataset.rows
        .map((row, index) => ({ row, index }))
        .sort((left, right) => {
          for (const sort of command.sorts) {
            const leftValue = left.row.values[sort.columnId];
            const rightValue = right.row.values[sort.columnId];
            if (leftValue === null && rightValue !== null) return 1;
            if (leftValue !== null && rightValue === null) return -1;
            const comparison = compareValues(leftValue, rightValue);
            if (comparison !== 0) return sort.direction === 'asc' ? comparison : -comparison;
          }
          return left.index - right.index;
        })
        .map(({ row }) => row));
    }
    case 'filter':
      hasColumn(dataset, command.columnId);
      return copyDataset(dataset, dataset.columns, dataset.rows.filter((row) => matchesFilter(row.values[command.columnId], command.operator, command.value)));
    case 'removeEmptyRows': {
      const columnIds = command.columnIds ?? dataset.columns.map((column) => column.id);
      assertKnownColumns(dataset, columnIds);
      return copyDataset(dataset, dataset.columns, dataset.rows.filter((row) => !columnIds.every((columnId) => isEmpty(row.values[columnId]))));
    }
    case 'deduplicate': {
      assertKnownColumns(dataset, command.columnIds);
      const rows = command.keep === 'first' ? dataset.rows : [...dataset.rows].reverse();
      const seen = new Set<string>();
      const retained = rows.filter((row) => {
        const key = stableKey(command.columnIds.map((columnId) => row.values[columnId]));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return copyDataset(dataset, dataset.columns, command.keep === 'first' ? retained : retained.reverse());
    }
    case 'renameHeader':
      hasColumn(dataset, command.columnId);
      return copyDataset(dataset, dataset.columns.map((column) => column.id === command.columnId ? { ...column, header: command.header } : column));
    case 'splitColumn': {
      hasColumn(dataset, command.columnId);
      if (command.newColumns.length === 0 || command.delimiter === '') throw new RangeError('Split needs columns and a delimiter');
      assertNewColumns(dataset, command.newColumns);
      const sourceIndex = dataset.columns.findIndex((column) => column.id === command.columnId);
      let columns = dataset.columns;
      command.newColumns.forEach((column, index) => { columns = appendColumn(copyDataset(dataset, columns), column, sourceIndex + index + 1); });
      return copyDataset(dataset, columns, dataset.rows.map((row) => {
        const sourceValue = row.values[command.columnId];
        const parts = typeof sourceValue === 'string' ? sourceValue.split(command.delimiter) : [];
        return { ...row, values: { ...row.values, ...Object.fromEntries(command.newColumns.map((column, index) => [column.id, parts[index] || null])) } };
      }));
    }
    case 'combineColumns': {
      assertKnownColumns(dataset, command.columnIds);
      assertNewColumns(dataset, [command.newColumn]);
      return copyDataset(dataset, appendColumn(dataset, command.newColumn), dataset.rows.map((row) => ({
        ...row,
        values: { ...row.values, [command.newColumn.id]: command.columnIds.map((columnId) => row.values[columnId]).filter((value) => !isEmpty(value)).map(toText).join(command.separator) || null },
      })));
    }
    case 'findReplace':
      assertKnownColumns(dataset, command.columnIds);
      return replaceValues(dataset, (row) => ({ ...row.values, ...Object.fromEntries(command.columnIds.map((columnId) => [columnId, replaceLiteral(row.values[columnId], command.find, command.replace, command.caseSensitive ?? false)])) }));
    case 'dateConversion':
      hasColumn(dataset, command.columnId);
      return replaceValues(copyDataset(dataset, dataset.columns.map((column) => column.id === command.columnId ? { ...column, detectedType: 'date' } : column)), (row) => {
        const date = parseDate(row.values[command.columnId], command.inputFormat);
        return { ...row.values, [command.columnId]: date === null ? null : formatDate(date, command.outputFormat) };
      });
    case 'numberConversion':
      hasColumn(dataset, command.columnId);
      return replaceValues(copyDataset(dataset, dataset.columns.map((column) => column.id === command.columnId ? { ...column, detectedType: 'number' } : column)), (row) => ({ ...row.values, [command.columnId]: parseNumber(row.values[command.columnId], command.decimalSeparator) }));
    case 'currencyConversion': {
      hasColumn(dataset, command.columnId);
      const formatter = new Intl.NumberFormat(command.locale, { style: 'currency', currency: command.currency });
      return replaceValues(copyDataset(dataset, dataset.columns.map((column) => column.id === command.columnId ? { ...column, detectedType: 'string' } : column)), (row) => {
        const value = row.values[command.columnId];
        return { ...row.values, [command.columnId]: typeof value === 'number' && Number.isFinite(value) ? formatter.format(value) : null };
      });
    }
    case 'prefix':
      hasColumn(dataset, command.columnId);
      return replaceValues(dataset, (row) => ({ ...row.values, [command.columnId]: isEmpty(row.values[command.columnId]) ? row.values[command.columnId] : `${command.value}${toText(row.values[command.columnId])}` }));
    case 'suffix':
      hasColumn(dataset, command.columnId);
      return replaceValues(dataset, (row) => ({ ...row.values, [command.columnId]: isEmpty(row.values[command.columnId]) ? row.values[command.columnId] : `${toText(row.values[command.columnId])}${command.value}` }));
    case 'fixedValue':
      hasColumn(dataset, command.columnId);
      return replaceValues(dataset, (row) => ({ ...row.values, [command.columnId]: command.value }));
    case 'calculatedColumn':
      assertNewColumns(dataset, [command.newColumn]);
      return copyDataset(dataset, appendColumn(dataset, command.newColumn), dataset.rows.map((row) => ({ ...row, values: { ...row.values, [command.newColumn.id]: evaluateExpression(command.expression, row) } })));
    case 'conditionalRule':
      assertKnownColumns(dataset, command.updates.map((update) => update.columnId));
      return replaceValues(dataset, (row) => Boolean(evaluateExpression(command.condition, row))
        ? { ...row.values, ...Object.fromEntries(command.updates.map((update) => [update.columnId, update.value])) }
        : row.values);
    case 'editCell':
      hasColumn(dataset, command.columnId);
      if (!dataset.rows.some((row) => row.rowId === command.rowId)) throw new RangeError(`Unknown row: ${command.rowId}`);
      return replaceValues(dataset, (row) => row.rowId === command.rowId ? { ...row.values, [command.columnId]: command.value } : row.values);
  }
}
