import type { CellValue, Dataset } from '../dataset/types';
import type {
  ConditionalConstraint,
  ConditionalMatrixEntry,
  ConditionalMatrixRule,
  MatrixCondition,
} from './types';

function stableValue(value: CellValue): string {
  return JSON.stringify([typeof value, value]);
}

function stableCondition(condition: MatrixCondition): string {
  return condition.operator === 'equals'
    ? `equals:${stableValue(condition.value)}`
    : condition.operator;
}

function stableConstraint(constraint: ConditionalConstraint): string {
  return JSON.stringify(constraint);
}

function duplicateValues(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts].filter(([, count]) => count > 1).map(([value]) => value);
}

function conditionsOverlap(left: MatrixCondition, right: MatrixCondition): boolean {
  if (left.operator === 'any' || right.operator === 'any') return true;
  if (left.operator === 'empty' || right.operator === 'empty') return left.operator === right.operator;
  return stableValue(left.value) === stableValue(right.value);
}

function constraintsConflict(left: ConditionalConstraint, right: ConditionalConstraint): boolean {
  if (left.type === 'any' || right.type === 'any') return false;
  if (left.type === 'equals' && right.type === 'equals') return !Object.is(left.value, right.value);
  if (left.type === 'empty' && right.type === 'required') return true;
  if (left.type === 'required' && right.type === 'empty') return true;
  if (left.type === 'allowed' && right.type === 'allowed') {
    return !left.allowedValues.some((value) => right.allowedValues.some((other) => stableValue(value) === stableValue(other)));
  }
  if (left.type === 'type' && right.type === 'type') return left.valueType !== right.valueType;
  if (left.type === 'numberRange' && right.type === 'numberRange') {
    const min = Math.max(left.min ?? -Infinity, right.min ?? -Infinity);
    const max = Math.min(left.max ?? Infinity, right.max ?? Infinity);
    return min > max;
  }
  if (left.type === 'dateRange' && right.type === 'dateRange') {
    const min = [left.min, right.min].filter((value): value is string => value !== undefined).sort().at(-1);
    const max = [left.max, right.max].filter((value): value is string => value !== undefined).sort()[0];
    return min !== undefined && max !== undefined && min > max;
  }
  if (left.type === 'stringLength' && right.type === 'stringLength') {
    const min = Math.max(left.min ?? -Infinity, right.min ?? -Infinity);
    const max = Math.min(left.max ?? Infinity, right.max ?? Infinity);
    return min > max;
  }
  return stableConstraint(left) !== stableConstraint(right)
    && (left.type === 'empty' || right.type === 'empty' || left.type === 'equals' || right.type === 'equals');
}

function entriesOverlap(rule: ConditionalMatrixRule, left: ConditionalMatrixEntry, right: ConditionalMatrixEntry): boolean {
  return rule.keyColumnIds.every((columnId) => {
    const leftCondition = left.conditions[columnId];
    const rightCondition = right.conditions[columnId];
    return leftCondition !== undefined && rightCondition !== undefined && conditionsOverlap(leftCondition, rightCondition);
  });
}

export function validateConditionalMatrixRule(rule: ConditionalMatrixRule, columnIds: readonly string[]): string[] {
  const errors: string[] = [];
  const knownColumns = new Set(columnIds);
  if (rule.keyColumnIds.length === 0) errors.push('A matriz deve conter pelo menos uma coluna-chave.');
  if (rule.dependentColumnIds.length === 0) errors.push('A matriz deve conter pelo menos uma coluna dependente.');
  if (rule.entries.length === 0) errors.push('A matriz deve conter pelo menos uma linha.');
  duplicateValues(rule.keyColumnIds).forEach((columnId) => errors.push(`A coluna-chave da matriz está duplicada: ${columnId}.`));
  duplicateValues(rule.dependentColumnIds).forEach((columnId) => errors.push(`A coluna dependente da matriz está duplicada: ${columnId}.`));
  rule.keyColumnIds.forEach((columnId) => {
    if (!knownColumns.has(columnId)) errors.push(`A coluna-chave da matriz não existe: ${columnId}.`);
  });
  rule.dependentColumnIds.forEach((columnId) => {
    if (!knownColumns.has(columnId)) errors.push(`A coluna dependente da matriz não existe: ${columnId}.`);
    if (rule.keyColumnIds.includes(columnId)) errors.push(`A coluna da matriz não pode ser chave e dependente: ${columnId}.`);
  });
  rule.entries.forEach((entry, entryIndex) => {
    rule.keyColumnIds.forEach((columnId) => {
      if (!entry.conditions[columnId]) errors.push(`A linha ${entryIndex + 1} da matriz não possui condição: ${columnId}.`);
    });
    Object.keys(entry.constraints).forEach((columnId) => {
      if (!rule.dependentColumnIds.includes(columnId)) errors.push(`A linha ${entryIndex + 1} da matriz possui uma coluna dependente desconhecida: ${columnId}.`);
    });
  });
  for (let leftIndex = 0; leftIndex < rule.entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rule.entries.length; rightIndex += 1) {
      const left = rule.entries[leftIndex];
      const right = rule.entries[rightIndex];
      if (!entriesOverlap(rule, left, right)) continue;
      const dependentIds = new Set([...Object.keys(left.constraints), ...Object.keys(right.constraints)]);
      for (const columnId of dependentIds) {
        const leftConstraint = left.constraints[columnId];
        const rightConstraint = right.constraints[columnId];
        if (leftConstraint && rightConstraint && constraintsConflict(leftConstraint, rightConstraint)) {
          errors.push(`As linhas ${leftIndex + 1} e ${rightIndex + 1} da matriz entram em conflito para as mesmas condições.`);
          break;
        }
      }
    }
  }
  return [...new Set(errors)];
}

export function distinctMatrixEntries(
  dataset: Dataset,
  keyColumnIds: readonly string[],
  dependentColumnIds: readonly string[],
): ConditionalMatrixEntry[] {
  const seen = new Set<string>();
  const entries: ConditionalMatrixEntry[] = [];
  for (const row of dataset.rows) {
    const conditions = Object.fromEntries(keyColumnIds.map((columnId) => {
      const value = row.values[columnId] ?? null;
      return [columnId, value === null || (typeof value === 'string' && value.trim() === '')
        ? { operator: 'empty' as const }
        : { operator: 'equals' as const, value }];
    }));
    const constraints = Object.fromEntries(dependentColumnIds.map((columnId) => {
      const value = row.values[columnId] ?? null;
      return [columnId, value === null || (typeof value === 'string' && value.trim() === '')
        ? { type: 'empty' as const }
        : { type: 'equals' as const, value }];
    }));
    const key = JSON.stringify({ conditions: keyColumnIds.map((columnId) => stableCondition(conditions[columnId])), constraints: dependentColumnIds.map((columnId) => stableConstraint(constraints[columnId])) });
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ conditions, constraints });
  }
  return entries;
}
