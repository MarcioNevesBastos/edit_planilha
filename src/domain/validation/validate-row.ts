import type { CellValue, DataRow, Dataset } from '../dataset/types';
import type {
  ConditionalConstraint,
  ConditionalMatrixEntry,
  ConditionalMatrixRule,
  MatrixCondition,
  ValidationIssue,
  ValidationResult,
  ValidationRule,
  ValidationSeverity,
  ValidationValueType,
} from './types';

function isEmpty(value: CellValue): boolean {
  return value === null || (typeof value === 'string' && value.trim() === '');
}

function parseDate(value: CellValue): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(?:(\d{4})-(\d{2})-(\d{2})|(\d{2})\/(\d{2})\/(\d{4}))$/);
  if (!match) return null;

  const year = Number(match[1] ?? match[6]);
  const month = Number(match[2] ?? match[5]);
  const day = Number(match[3] ?? match[4]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? timestamp : null;
}

function matchesType(value: CellValue, valueType: ValidationValueType): boolean {
  switch (valueType) {
    case 'date': return parseDate(value) !== null;
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    default: return typeof value === valueType;
  }
}

function issue(
  row: DataRow,
  columnId: string,
  code: string,
  value: CellValue,
  message: string,
  severity: ValidationSeverity = 'error',
): ValidationIssue {
  return { rowId: row.rowId, sourceRowNumber: row.sourceRowNumber, columnId, code, value, message, severity };
}

function stableKey(values: readonly CellValue[]): string {
  return JSON.stringify(values.map((value) => [typeof value, value]));
}

type LocalValidationRule = Exclude<ValidationRule, { type: 'unique' } | { type: 'compositeUnique' } | ConditionalMatrixRule>;

function validateLocalRule(
  row: DataRow,
  rule: LocalValidationRule,
  severity: ValidationSeverity = 'error',
  codePrefix = '',
): ValidationIssue[] {
  const value = row.values[rule.columnId] ?? null;
  if (rule.type === 'required') {
    return isEmpty(value) ? [issue(row, rule.columnId, `${codePrefix}required`, value, 'A value is required.', severity)] : [];
  }
  if (isEmpty(value)) return [];

  switch (rule.type) {
    case 'type':
      return matchesType(value, rule.valueType) ? [] : [issue(row, rule.columnId, `${codePrefix}type`, value, `Expected a ${rule.valueType} value.`, severity)];
    case 'allowed':
      return rule.allowedValues.includes(value) ? [] : [issue(row, rule.columnId, `${codePrefix}allowed`, value, 'Value is not in the allowed list.', severity)];
    case 'numberRange': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [];
      const issues: ValidationIssue[] = [];
      if (rule.min !== undefined && value < rule.min) issues.push(issue(row, rule.columnId, `${codePrefix}min`, value, `Value must be at least ${rule.min}.`, severity));
      if (rule.max !== undefined && value > rule.max) issues.push(issue(row, rule.columnId, `${codePrefix}max`, value, `Value must be at most ${rule.max}.`, severity));
      return issues;
    }
    case 'dateRange': {
      const timestamp = parseDate(value);
      if (timestamp === null) return [];
      const issues: ValidationIssue[] = [];
      const min = rule.min === undefined ? null : parseDate(rule.min);
      const max = rule.max === undefined ? null : parseDate(rule.max);
      if (min !== null && timestamp < min) issues.push(issue(row, rule.columnId, `${codePrefix}date_min`, value, `Date must be on or after ${rule.min}.`, severity));
      if (max !== null && timestamp > max) issues.push(issue(row, rule.columnId, `${codePrefix}date_max`, value, `Date must be on or before ${rule.max}.`, severity));
      return issues;
    }
    case 'stringLength': {
      if (typeof value !== 'string') return [];
      const issues: ValidationIssue[] = [];
      if (rule.min !== undefined && value.length < rule.min) issues.push(issue(row, rule.columnId, `${codePrefix}min_length`, value, `Text must contain at least ${rule.min} characters.`, severity));
      if (rule.max !== undefined && value.length > rule.max) issues.push(issue(row, rule.columnId, `${codePrefix}max_length`, value, `Text must contain at most ${rule.max} characters.`, severity));
      return issues;
    }
  }
}

export function validateRow(row: DataRow, rules: readonly ValidationRule[]): ValidationIssue[] {
  return rules.flatMap((rule) => {
    if (rule.type === 'unique' || rule.type === 'compositeUnique') return [];
    if (rule.type === 'conditionalMatrix') return validateConditionalMatrixRow(row, rule);
    return validateLocalRule(row, rule);
  });
}

function sameValue(left: CellValue, right: CellValue): boolean {
  return stableKey([left]) === stableKey([right]);
}

function matchesCondition(value: CellValue, condition: MatrixCondition): boolean {
  if (condition.operator === 'any') return true;
  if (condition.operator === 'empty') return isEmpty(value);
  return sameValue(value, condition.value);
}

export function matchesConditionalMatrixEntry(row: DataRow, rule: ConditionalMatrixRule, entry: ConditionalMatrixEntry): boolean {
  return rule.keyColumnIds.every((columnId) => {
    const condition = entry.conditions[columnId];
    return condition ? matchesCondition(row.values[columnId] ?? null, condition) : false;
  });
}

function conditionalIssue(
  row: DataRow,
  columnId: string,
  code: string,
  value: CellValue,
  message: string,
): ValidationIssue {
  return issue(row, columnId, `conditional_${code}`, value, message, 'warning');
}

function validateConditionalConstraint(
  row: DataRow,
  columnId: string,
  constraint: ConditionalConstraint,
): ValidationIssue[] {
  const value = row.values[columnId] ?? null;
  switch (constraint.type) {
    case 'any':
    case 'unique':
    case 'compositeUnique':
      return [];
    case 'required':
      return isEmpty(value) ? [conditionalIssue(row, columnId, 'required', value, 'A value is required by the matching conditional rule.')] : [];
    case 'empty':
      return isEmpty(value) ? [] : [conditionalIssue(row, columnId, 'empty', value, 'Value must be empty for the matching conditional rule.')];
    case 'equals':
      return sameValue(value, constraint.value) ? [] : [conditionalIssue(row, columnId, 'equals', value, 'Value does not match the matching conditional rule.')];
    default: {
      const issues = validateLocalRule(row, { ...constraint, columnId } as LocalValidationRule, 'warning', 'conditional_');
      return issues.map((current) => ({
        ...current,
        message: `Conditional rule: ${current.message}`,
      }));
    }
  }
}

function validateConditionalMatrixRow(row: DataRow, rule: ConditionalMatrixRule): ValidationIssue[] {
  const matchingEntries = rule.entries.filter((entry) => matchesConditionalMatrixEntry(row, rule, entry));
  if (matchingEntries.length === 0) {
    const columnId = rule.keyColumnIds[0] ?? rule.dependentColumnIds[0] ?? '';
    return [conditionalIssue(row, columnId, 'no_match', row.values[columnId] ?? null, 'No conditional matrix row matches this record.')];
  }
  return matchingEntries.flatMap((entry) => rule.dependentColumnIds.flatMap((columnId) => {
    const constraint = entry.constraints[columnId];
    return constraint ? validateConditionalConstraint(row, columnId, constraint) : [];
  }));
}

function validateUniqueRule(dataset: Dataset, rule: Extract<ValidationRule, { type: 'unique' }>): ValidationIssue[] {
  const groups = new Map<string, DataRow[]>();
  for (const row of dataset.rows) {
    const value = row.values[rule.columnId] ?? null;
    if (isEmpty(value)) continue;
    const key = stableKey([value]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].flatMap((rows) => rows.length > 1
    ? rows.map((row) => issue(row, rule.columnId, 'unique', row.values[rule.columnId] ?? null, 'Value must be unique.'))
    : []);
}

function validateConditionalUniqueRule(
  dataset: Dataset,
  matrix: ConditionalMatrixRule,
  entry: ConditionalMatrixEntry,
  columnId: string,
  compositeColumnIds?: readonly string[],
): ValidationIssue[] {
  const matchingRows = dataset.rows.filter((row) => matchesConditionalMatrixEntry(row, matrix, entry));
  if (compositeColumnIds && compositeColumnIds.length === 0) return [];
  const groups = new Map<string, DataRow[]>();
  for (const row of matchingRows) {
    const values = compositeColumnIds
      ? compositeColumnIds.map((current) => row.values[current] ?? null)
      : [row.values[columnId] ?? null];
    if (values.some(isEmpty)) continue;
    const key = stableKey(values);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].flatMap((rows) => rows.length > 1
    ? rows.map((row) => issue(
      row,
      columnId,
      compositeColumnIds ? 'conditional_composite_unique' : 'conditional_unique',
      row.values[columnId] ?? null,
      compositeColumnIds ? 'Combined values must be unique within the conditional context.' : 'Value must be unique within the conditional context.',
      'warning',
    ))
    : []);
}

function validateCompositeUniqueRule(dataset: Dataset, rule: Extract<ValidationRule, { type: 'compositeUnique' }>): ValidationIssue[] {
  if (rule.columnIds.length === 0) return [];
  const groups = new Map<string, DataRow[]>();
  for (const row of dataset.rows) {
    const values = rule.columnIds.map((columnId) => row.values[columnId] ?? null);
    if (values.some(isEmpty)) continue;
    const key = stableKey(values);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].flatMap((rows) => rows.length > 1
    ? rows.map((row) => issue(row, rule.columnIds[0], 'composite_unique', row.values[rule.columnIds[0]] ?? null, 'Combined values must be unique.'))
    : []);
}

export function validateDataset(dataset: Dataset, rules: readonly ValidationRule[]): ValidationResult {
  const issues = dataset.rows.flatMap((row) => validateRow(row, rules));
  for (const rule of rules) {
    if (rule.type === 'unique') issues.push(...validateUniqueRule(dataset, rule));
    if (rule.type === 'compositeUnique') issues.push(...validateCompositeUniqueRule(dataset, rule));
    if (rule.type === 'conditionalMatrix') {
      for (const entry of rule.entries) {
        for (const columnId of rule.dependentColumnIds) {
          const constraint = entry.constraints[columnId];
          if (!constraint) continue;
          if (constraint.type === 'unique') issues.push(...validateConditionalUniqueRule(dataset, rule, entry, columnId));
          if (constraint.type === 'compositeUnique') {
            issues.push(...validateConditionalUniqueRule(dataset, rule, entry, constraint.columnIds[0] ?? columnId, constraint.columnIds));
          }
        }
      }
    }
  }
  return { isValid: issues.every(({ severity }) => (severity ?? 'error') !== 'error'), issues };
}
