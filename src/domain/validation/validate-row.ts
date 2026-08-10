import type { CellValue, DataRow, Dataset } from '../dataset/types';
import type { ValidationIssue, ValidationResult, ValidationRule, ValidationValueType } from './types';

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

function issue(row: DataRow, columnId: string, code: string, value: CellValue, message: string): ValidationIssue {
  return { rowId: row.rowId, sourceRowNumber: row.sourceRowNumber, columnId, code, value, message };
}

function stableKey(values: readonly CellValue[]): string {
  return JSON.stringify(values.map((value) => [typeof value, value]));
}

function validateLocalRule(row: DataRow, rule: Exclude<ValidationRule, { type: 'unique' } | { type: 'compositeUnique' }>): ValidationIssue[] {
  const value = row.values[rule.columnId] ?? null;
  if (rule.type === 'required') {
    return isEmpty(value) ? [issue(row, rule.columnId, 'required', value, 'A value is required.')] : [];
  }
  if (isEmpty(value)) return [];

  switch (rule.type) {
    case 'type':
      return matchesType(value, rule.valueType) ? [] : [issue(row, rule.columnId, 'type', value, `Expected a ${rule.valueType} value.`)];
    case 'allowed':
      return rule.allowedValues.includes(value) ? [] : [issue(row, rule.columnId, 'allowed', value, 'Value is not in the allowed list.')];
    case 'numberRange': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [];
      const issues: ValidationIssue[] = [];
      if (rule.min !== undefined && value < rule.min) issues.push(issue(row, rule.columnId, 'min', value, `Value must be at least ${rule.min}.`));
      if (rule.max !== undefined && value > rule.max) issues.push(issue(row, rule.columnId, 'max', value, `Value must be at most ${rule.max}.`));
      return issues;
    }
    case 'dateRange': {
      const timestamp = parseDate(value);
      if (timestamp === null) return [];
      const issues: ValidationIssue[] = [];
      const min = rule.min === undefined ? null : parseDate(rule.min);
      const max = rule.max === undefined ? null : parseDate(rule.max);
      if (min !== null && timestamp < min) issues.push(issue(row, rule.columnId, 'date_min', value, `Date must be on or after ${rule.min}.`));
      if (max !== null && timestamp > max) issues.push(issue(row, rule.columnId, 'date_max', value, `Date must be on or before ${rule.max}.`));
      return issues;
    }
    case 'stringLength': {
      if (typeof value !== 'string') return [];
      const issues: ValidationIssue[] = [];
      if (rule.min !== undefined && value.length < rule.min) issues.push(issue(row, rule.columnId, 'min_length', value, `Text must contain at least ${rule.min} characters.`));
      if (rule.max !== undefined && value.length > rule.max) issues.push(issue(row, rule.columnId, 'max_length', value, `Text must contain at most ${rule.max} characters.`));
      return issues;
    }
  }
}

export function validateRow(row: DataRow, rules: readonly ValidationRule[]): ValidationIssue[] {
  return rules.flatMap((rule) => rule.type === 'unique' || rule.type === 'compositeUnique' ? [] : validateLocalRule(row, rule));
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
  }
  return { isValid: issues.length === 0, issues };
}
