import type { CellValue, DataRow } from '../dataset/types';
import type { Expression, TransformConditionNode } from '../transforms/types';
import type { ConditionalMatrixRule, ValidationComparisonOperator, ValidationOperand, ValidationRule } from './types';
import { validateConditionalMatrixRule } from './matrix';
import type { ValidationConfigurationError } from './types';

function isEmpty(value: CellValue): boolean {
  return value === null || (typeof value === 'string' && value.trim() === '');
}

function sameValue(left: CellValue, right: CellValue): boolean {
  return JSON.stringify([typeof left, left]) === JSON.stringify([typeof right, right]);
}

export function evaluateExpression(expression: Expression, row: DataRow): CellValue {
  switch (expression.type) {
    case 'literal': return expression.value;
    case 'column': return row.values[expression.columnId] ?? null;
    case 'unary': {
      const operand = evaluateExpression(expression.operand, row);
      return expression.operator === 'not'
        ? !Boolean(operand)
        : typeof operand === 'number' && Number.isFinite(operand) ? -operand : null;
    }
    case 'binary': {
      const left = evaluateExpression(expression.left, row);
      const right = evaluateExpression(expression.right, row);
      switch (expression.operator) {
        case '==': return sameValue(left, right);
        case '!=': return !sameValue(left, right);
        case 'and': return Boolean(left) && Boolean(right);
        case 'or': return Boolean(left) || Boolean(right);
        case '+': return typeof left === 'number' && typeof right === 'number' ? left + right : null;
        case '-': return typeof left === 'number' && typeof right === 'number' ? left - right : null;
        case '*': return typeof left === 'number' && typeof right === 'number' ? left * right : null;
        case '/': return typeof left === 'number' && typeof right === 'number' && right !== 0 ? left / right : null;
        case '>': return typeof left === 'number' && typeof right === 'number' ? left > right : false;
        case '>=': return typeof left === 'number' && typeof right === 'number' ? left >= right : false;
        case '<': return typeof left === 'number' && typeof right === 'number' ? left < right : false;
        case '<=': return typeof left === 'number' && typeof right === 'number' ? left <= right : false;
      }
    }
  }
}

function operandValue(operand: ValidationOperand, row: DataRow): CellValue {
  return operand.type === 'column' ? row.values[operand.columnId] ?? null : operand.value;
}

export function matchesComparison(left: CellValue, operator: ValidationComparisonOperator, right: CellValue): boolean {
  switch (operator) {
    case 'equals': return sameValue(left, right);
    case 'notEquals': return !sameValue(left, right);
    case 'greaterThan': return typeof left === 'number' && typeof right === 'number' && left > right;
    case 'greaterThanOrEqual': return typeof left === 'number' && typeof right === 'number' && left >= right;
    case 'lessThan': return typeof left === 'number' && typeof right === 'number' && left < right;
    case 'lessThanOrEqual': return typeof left === 'number' && typeof right === 'number' && left <= right;
  }
}

export function evaluateComparison(rule: Extract<ValidationRule, { type: 'comparison' }>, row: DataRow): boolean {
  return matchesComparison(operandValue(rule.left, row), rule.operator, operandValue(rule.right, row));
}

export function matchesWhen(condition: TransformConditionNode | undefined, row: DataRow): boolean {
  if (!condition) return true;
  if (condition.type === 'group') {
    const matches = condition.children.map((child) => matchesWhen(child, row));
    return condition.operator === 'and' ? matches.every(Boolean) : matches.some(Boolean);
  }
  const value = row.values[condition.columnId] ?? null;
  const operand = condition.operand?.type === 'column'
    ? row.values[condition.operand.columnId] ?? null
    : condition.operand?.value ?? null;
  switch (condition.operator) {
    case 'equals': return sameValue(value, operand);
    case 'notEquals': return !sameValue(value, operand);
    case 'contains': return typeof value === 'string' && value.includes(String(operand ?? ''));
    case 'isEmpty': return isEmpty(value);
    case 'notEmpty': return !isEmpty(value);
    case 'greaterThan': return typeof value === 'number' && typeof operand === 'number' && value > operand;
    case 'greaterThanOrEqual': return typeof value === 'number' && typeof operand === 'number' && value >= operand;
    case 'lessThan': return typeof value === 'number' && typeof operand === 'number' && value < operand;
    case 'lessThanOrEqual': return typeof value === 'number' && typeof operand === 'number' && value <= operand;
  }
}

function expressionColumnIds(expression: Expression): string[] {
  if (expression.type === 'column') return [expression.columnId];
  if (expression.type === 'literal') return [];
  if (expression.type === 'unary') return expressionColumnIds(expression.operand);
  return [...expressionColumnIds(expression.left), ...expressionColumnIds(expression.right)];
}

function matrixColumnIds(rule: ConditionalMatrixRule): string[] {
  return [
    ...rule.keyColumnIds,
    ...rule.dependentColumnIds,
    ...rule.entries.flatMap((entry) => Object.values(entry.constraints).flatMap((constraint) => constraint.type === 'compositeUnique' ? constraint.columnIds : [])),
  ];
}

export function validationRuleColumnIds(rule: ValidationRule): string[] {
  if (rule.type === 'conditionalMatrix') return matrixColumnIds(rule);
  if (rule.type === 'comparison') return [
    ...(rule.left.type === 'column' ? [rule.left.columnId] : []),
    ...(rule.right.type === 'column' ? [rule.right.columnId] : []),
  ];
  if (rule.type === 'expression') return expressionColumnIds(rule.expression);
  if (rule.type === 'reference') return [rule.columnId, rule.referenceColumnId];
  return 'columnIds' in rule ? [...rule.columnIds] : [rule.columnId];
}

export function getValidationRuleId(rule: ValidationRule, index = 0): string {
  return rule.id ?? `${rule.type}-${index + 1}`;
}

export function validateRuleConfiguration(rule: ValidationRule, columnIds: readonly string[]): string[] {
  const knownColumns = new Set(columnIds);
  const errors: string[] = [];
  for (const columnId of columnIds.length > 0 ? [...new Set(validationRuleColumnIds(rule))] : []) {
    if (!knownColumns.has(columnId)) errors.push(`A coluna da regra não existe: ${columnId}.`);
  }
  if (rule.type === 'allowed' && rule.allowedValues.length === 0) errors.push('A lista permitida não pode estar vazia.');
  if (rule.type === 'numberRange' || rule.type === 'stringLength') {
    if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) errors.push('O limite mínimo não pode ser maior que o máximo.');
    if (rule.min !== undefined && rule.min < 0) errors.push('O limite mínimo não pode ser negativo.');
  }
  if (rule.type === 'dateRange' && rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
    errors.push('A data mínima não pode ser posterior à data máxima.');
  }
  if (rule.type === 'compositeUnique' && rule.columnIds.length === 0) errors.push('A chave composta deve conter ao menos uma coluna.');
  if (rule.type === 'conditionalMatrix' && columnIds.length > 0) errors.push(...validateConditionalMatrixRule(rule, columnIds));
  return errors;
}

function comparableRule(rule: ValidationRule): string {
  const { id: _id, name: _name, enabled: _enabled, severity: _severity, message: _message, when: _when, ...definition } = rule;
  return JSON.stringify(definition);
}

function rangesDoNotOverlap(left: Extract<ValidationRule, { type: 'numberRange' | 'dateRange' }>, right: Extract<ValidationRule, { type: 'numberRange' | 'dateRange' }>): boolean {
  if (left.type !== right.type || left.columnId !== right.columnId) return false;
  const leftMax = left.max ?? Infinity;
  const rightMax = right.max ?? Infinity;
  const leftMin = left.min ?? -Infinity;
  const rightMin = right.min ?? -Infinity;
  return Math.max(leftMin as number, rightMin as number) > Math.min(leftMax as number, rightMax as number);
}

export function analyzeValidationRules(rules: readonly ValidationRule[], columnIds: readonly string[]): ValidationConfigurationError[] {
  const errors = rules.flatMap((rule, index) => validateRuleConfiguration(rule, columnIds).map((message) => ({ ruleId: getValidationRuleId(rule, index), message })));
  for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex += 1) {
      const left = rules[leftIndex];
      const right = rules[rightIndex];
      const leftId = getValidationRuleId(left, leftIndex);
      const rightId = getValidationRuleId(right, rightIndex);
      if (comparableRule(left) === comparableRule(right)) {
        errors.push({ ruleId: leftId, message: `As regras ${leftId} e ${rightId} são duplicadas.` });
      } else if ((left.type === 'numberRange' || left.type === 'dateRange') && (right.type === 'numberRange' || right.type === 'dateRange') && rangesDoNotOverlap(left, right)) {
        errors.push({ ruleId: leftId, message: `As regras ${leftId} e ${rightId} não possuem valores em comum.` });
      }
    }
  }
  return errors;
}
