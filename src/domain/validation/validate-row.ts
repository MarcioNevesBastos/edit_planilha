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
import {
  evaluateComparison,
  evaluateExpression,
  getValidationRuleId,
  matchesWhen,
  analyzeValidationRules,
  validationRuleColumnIds,
} from './rule-analysis';

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

function valueTypeLabel(valueType: ValidationValueType): string {
  return ({ string: 'texto', number: 'número', date: 'data', boolean: 'booleano' })[valueType];
}

function issue(
  row: DataRow,
  columnId: string,
  code: string,
  value: CellValue,
  message: string,
  severity: ValidationSeverity = 'error',
  ruleId?: string,
): ValidationIssue {
  return { rowId: row.rowId, sourceRowNumber: row.sourceRowNumber, columnId, code, value, message, severity, ruleId };
}

function stableKey(values: readonly CellValue[]): string {
  return JSON.stringify(values.map((value) => [typeof value, value]));
}

type LocalValidationRule = Exclude<
  ValidationRule,
  { type: 'unique' } | { type: 'compositeUnique' } | ConditionalMatrixRule | { type: 'comparison' } | { type: 'expression' } | { type: 'reference' }
>;

function validateLocalRule(
  row: DataRow,
  rule: LocalValidationRule,
  severity: ValidationSeverity = 'error',
  codePrefix = '',
): ValidationIssue[] {
  const value = row.values[rule.columnId] ?? null;
  if (rule.type === 'required') {
    return isEmpty(value) ? [issue(row, rule.columnId, `${codePrefix}required`, value, 'O preenchimento de um valor é obrigatório.', severity)] : [];
  }
  if (isEmpty(value)) return [];

  switch (rule.type) {
    case 'type':
      return matchesType(value, rule.valueType) ? [] : [issue(row, rule.columnId, `${codePrefix}type`, value, `É esperado um valor do tipo ${valueTypeLabel(rule.valueType)}.`, severity)];
    case 'allowed':
      return rule.allowedValues.includes(value) ? [] : [issue(row, rule.columnId, `${codePrefix}allowed`, value, 'O valor não está na lista permitida.', severity)];
    case 'numberRange': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [];
      const issues: ValidationIssue[] = [];
      if (rule.min !== undefined && value < rule.min) issues.push(issue(row, rule.columnId, `${codePrefix}min`, value, `O valor deve ser no mínimo ${rule.min}.`, severity));
      if (rule.max !== undefined && value > rule.max) issues.push(issue(row, rule.columnId, `${codePrefix}max`, value, `O valor deve ser no máximo ${rule.max}.`, severity));
      return issues;
    }
    case 'dateRange': {
      const timestamp = parseDate(value);
      if (timestamp === null) return [];
      const issues: ValidationIssue[] = [];
      const min = rule.min === undefined ? null : parseDate(rule.min);
      const max = rule.max === undefined ? null : parseDate(rule.max);
      if (min !== null && timestamp < min) issues.push(issue(row, rule.columnId, `${codePrefix}date_min`, value, `A data deve ser igual ou posterior a ${rule.min}.`, severity));
      if (max !== null && timestamp > max) issues.push(issue(row, rule.columnId, `${codePrefix}date_max`, value, `A data deve ser igual ou anterior a ${rule.max}.`, severity));
      return issues;
    }
    case 'stringLength': {
      if (typeof value !== 'string') return [];
      const issues: ValidationIssue[] = [];
      if (rule.min !== undefined && value.length < rule.min) issues.push(issue(row, rule.columnId, `${codePrefix}min_length`, value, `O texto deve conter pelo menos ${rule.min} caracteres.`, severity));
      if (rule.max !== undefined && value.length > rule.max) issues.push(issue(row, rule.columnId, `${codePrefix}max_length`, value, `O texto deve conter no máximo ${rule.max} caracteres.`, severity));
      return issues;
    }
  }
}

function applyRuleMetadata(issues: ValidationIssue[], rule: ValidationRule, ruleId: string): ValidationIssue[] {
  return issues.map((current) => ({
    ...current,
    ruleId,
    severity: rule.severity ?? current.severity,
    message: rule.message ?? current.message,
  }));
}

function ruleFailure(
  row: DataRow,
  rule: Extract<ValidationRule, { type: 'comparison' | 'expression' }>,
  ruleId: string,
): ValidationIssue[] {
  const columnId = validationRuleColumnIds(rule)[0] ?? '';
  const value = row.values[columnId] ?? null;
  const valid = rule.type === 'comparison' ? evaluateComparison(rule, row) : evaluateExpression(rule.expression, row) === true;
  return valid ? [] : [issue(row, columnId, rule.type, value, rule.type === 'comparison' ? 'A comparação entre os valores não foi satisfeita.' : 'A expressão de validação não foi satisfeita.', rule.severity ?? 'error', ruleId)];
}

export function validateRow(row: DataRow, rules: readonly ValidationRule[]): ValidationIssue[] {
  return rules.flatMap((rule, index) => {
    if (rule.enabled === false || rule.type === 'unique' || rule.type === 'compositeUnique' || rule.type === 'reference') return [];
    if (!matchesWhen(rule.when, row)) return [];
    const ruleId = getValidationRuleId(rule, index);
    const issues = rule.type === 'conditionalMatrix'
      ? validateConditionalMatrixRow(row, rule)
      : rule.type === 'comparison' || rule.type === 'expression'
        ? ruleFailure(row, rule, ruleId)
        : validateLocalRule(row, rule);
    return applyRuleMetadata(issues, rule, ruleId);
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
      return isEmpty(value) ? [conditionalIssue(row, columnId, 'required', value, 'O preenchimento de um valor é obrigatório pela regra condicional correspondente.')] : [];
    case 'empty':
      return isEmpty(value) ? [] : [conditionalIssue(row, columnId, 'empty', value, 'O valor deve estar vazio para a regra condicional correspondente.')];
    case 'equals':
      return sameValue(value, constraint.value) ? [] : [conditionalIssue(row, columnId, 'equals', value, 'O valor não corresponde à regra condicional correspondente.')];
    default: {
      const issues = validateLocalRule(row, { ...constraint, columnId } as LocalValidationRule, 'warning', 'conditional_');
      return issues.map((current) => ({
        ...current,
        message: `Regra condicional: ${current.message}`,
      }));
    }
  }
}

function validateConditionalMatrixRow(row: DataRow, rule: ConditionalMatrixRule): ValidationIssue[] {
  const matchingEntries = rule.entries.filter((entry) => matchesConditionalMatrixEntry(row, rule, entry));
  if (matchingEntries.length === 0) {
    if (rule.noMatchBehavior === 'ignore') return [];
    const columnId = rule.keyColumnIds[0] ?? rule.dependentColumnIds[0] ?? '';
    return [issue(
      row,
      columnId,
      'conditional_no_match',
      row.values[columnId] ?? null,
      rule.message ?? 'Nenhuma linha da matriz condicional corresponde a este registro.',
      rule.noMatchBehavior === 'error' ? 'error' : rule.severity ?? 'warning',
    )];
  }
  return matchingEntries.flatMap((entry) => rule.dependentColumnIds.flatMap((columnId) => {
    const constraint = entry.constraints[columnId];
    return constraint ? validateConditionalConstraint(row, columnId, constraint) : [];
  }));
}

function validateUniqueRule(dataset: Dataset, rule: Extract<ValidationRule, { type: 'unique' }>, ruleId: string): ValidationIssue[] {
  const groups = new Map<string, DataRow[]>();
  for (const row of dataset.rows) {
    const value = row.values[rule.columnId] ?? null;
    if (isEmpty(value)) continue;
    const key = stableKey([value]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].flatMap((rows) => rows.length > 1
    ? rows.map((row) => issue(row, rule.columnId, 'unique', row.values[rule.columnId] ?? null, rule.message ?? 'O valor deve ser único.', rule.severity ?? 'error', ruleId))
    : []);
}

function validateConditionalUniqueRule(
  dataset: Dataset,
  matrix: ConditionalMatrixRule,
  entry: ConditionalMatrixEntry,
  columnId: string,
  compositeColumnIds?: readonly string[],
  ruleId = '',
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
      compositeColumnIds ? 'Os valores combinados devem ser únicos no contexto condicional.' : 'O valor deve ser único no contexto condicional.',
      matrix.severity ?? 'warning',
      ruleId,
    ))
    : []);
}

function validateCompositeUniqueRule(dataset: Dataset, rule: Extract<ValidationRule, { type: 'compositeUnique' }>, ruleId: string): ValidationIssue[] {
  if (rule.columnIds.length === 0) return [];
  const groups = new Map<string, DataRow[]>();
  for (const row of dataset.rows) {
    const values = rule.columnIds.map((columnId) => row.values[columnId] ?? null);
    if (values.some(isEmpty)) continue;
    const key = stableKey(values);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].flatMap((rows) => rows.length > 1
    ? rows.map((row) => issue(row, rule.columnIds[0], 'composite_unique', row.values[rule.columnIds[0]] ?? null, rule.message ?? 'Os valores combinados devem ser únicos.', rule.severity ?? 'error', ruleId))
    : []);
}

export function validateDataset(dataset: Dataset, rules: readonly ValidationRule[]): ValidationResult {
  const configurationErrors = analyzeValidationRules(rules, dataset.columns.map(({ id }) => id));
  const invalidRuleIds = new Set(configurationErrors.map(({ ruleId }) => ruleId));
  const validRules = rules.filter((rule, index) => !invalidRuleIds.has(getValidationRuleId(rule, index)));
  const issues = dataset.rows.flatMap((row) => validateRow(row, validRules));
  for (const [index, rule] of rules.entries()) {
    if (rule.enabled === false || invalidRuleIds.has(getValidationRuleId(rule, index))) continue;
    const ruleId = getValidationRuleId(rule, index);
    if (rule.type === 'unique') issues.push(...validateUniqueRule(dataset, rule, ruleId));
    if (rule.type === 'compositeUnique') issues.push(...validateCompositeUniqueRule(dataset, rule, ruleId));
    if (rule.type === 'reference') {
      const knownValues = new Set(dataset.rows.map((row) => row.values[rule.referenceColumnId] ?? null).filter((value) => !isEmpty(value)).map((value) => stableKey([value])));
      issues.push(...dataset.rows.filter((row) => {
        const exists = knownValues.has(stableKey([row.values[rule.columnId] ?? null]));
        return (rule.mode === 'exists' ? !exists : exists) && !isEmpty(row.values[rule.columnId] ?? null);
      }).map((row) => issue(row, rule.columnId, 'reference', row.values[rule.columnId] ?? null, rule.message ?? 'A referência não corresponde aos valores disponíveis.', rule.severity ?? 'error', ruleId)));
    }
    if (rule.type === 'conditionalMatrix') {
      for (const entry of rule.entries) {
        for (const columnId of rule.dependentColumnIds) {
          const constraint = entry.constraints[columnId];
          if (!constraint) continue;
          if (constraint.type === 'unique') issues.push(...validateConditionalUniqueRule(dataset, rule, entry, columnId, undefined, ruleId));
          if (constraint.type === 'compositeUnique') {
            issues.push(...validateConditionalUniqueRule(dataset, rule, entry, constraint.columnIds[0] ?? columnId, constraint.columnIds, ruleId));
          }
        }
      }
    }
  }
  const ruleImpact = Object.fromEntries(rules.map((rule, index) => {
    const ruleId = getValidationRuleId(rule, index);
    const ruleIssues = issues.filter((current) => current.ruleId === ruleId);
    return [ruleId, {
      affectedRows: new Set(ruleIssues.map(({ rowId }) => rowId)).size,
      affectedCells: new Set(ruleIssues.map(({ rowId, columnId }) => `${rowId}\u0000${columnId}`)).size,
    }];
  }));
  return {
    isValid: configurationErrors.length === 0 && issues.every(({ severity }) => (severity ?? 'error') !== 'error'),
    issues,
    configurationErrors,
    ruleImpact,
  };
}
