import React, { useEffect, useMemo, useState } from 'react';
import type { CellValue, Dataset, DatasetColumn } from '../../domain/dataset/types';
import type { Expression, TransformConditionNode } from '../../domain/transforms/types';
import { ConditionBuilder } from './ConditionBuilder';
import { ValidationExpressionBuilder } from './ValidationExpressionBuilder';
import type { ValidationRule, ValidationRuleMetadata } from '../../domain/validation/types';

export type EditableValidationRuleType = Exclude<ValidationRule['type'], 'conditionalMatrix'>;

interface ValidationRuleEditorProps {
  dataset: Dataset;
  columns: readonly DatasetColumn[];
  value: ValidationRule;
  disabled: boolean;
  onSave(rule: ValidationRule): void;
  onCancel(): void;
}

const DEFINITION_OPTIONS: Array<{ value: EditableValidationRuleType; label: string }> = [
  { value: 'required', label: 'Obrigatório' },
  { value: 'type', label: 'Tipo' },
  { value: 'allowed', label: 'Lista permitida' },
  { value: 'numberRange', label: 'Intervalo numérico' },
  { value: 'dateRange', label: 'Intervalo de datas' },
  { value: 'stringLength', label: 'Tamanho do texto' },
  { value: 'unique', label: 'Valor único' },
  { value: 'compositeUnique', label: 'Chave composta' },
  { value: 'comparison', label: 'Comparação entre colunas' },
  { value: 'expression', label: 'Expressão' },
  { value: 'reference', label: 'Referência entre registros' },
];

const metadata = (rule: ValidationRule): ValidationRuleMetadata => ({
  id: rule.id,
  name: rule.name,
  enabled: rule.enabled,
  severity: rule.severity,
  message: rule.message,
  when: rule.when,
});

function firstColumn(columns: readonly DatasetColumn[]): string {
  return columns[0]?.id ?? '';
}

function defaultExpression(columns: readonly DatasetColumn[]): Expression {
  return {
    type: 'binary',
    operator: '==',
    left: { type: 'column', columnId: firstColumn(columns) },
    right: { type: 'literal', value: null },
  };
}

export function createDefaultValidationRule(type: EditableValidationRuleType, columns: readonly DatasetColumn[]): ValidationRule {
  const columnId = firstColumn(columns);
  switch (type) {
    case 'required': return { type, columnId };
    case 'type': return { type, columnId, valueType: 'string' };
    case 'allowed': return { type, columnId, allowedValues: [] };
    case 'numberRange': return { type, columnId };
    case 'dateRange': return { type, columnId };
    case 'stringLength': return { type, columnId };
    case 'unique': return { type, columnId };
    case 'compositeUnique': return { type, columnIds: columnId ? [columnId] : [] };
    case 'comparison': return { type, left: { type: 'column', columnId }, operator: 'equals', right: { type: 'literal', value: null } };
    case 'expression': return { type, expression: defaultExpression(columns) };
    case 'reference': return { type, columnId, referenceColumnId: columnId, mode: 'exists' };
  }
}

function selectedColumn(rule: ValidationRule, columns: readonly DatasetColumn[]): string {
  if ('columnId' in rule) return rule.columnId;
  if (rule.type === 'compositeUnique') return rule.columnIds[0] ?? firstColumn(columns);
  if (rule.type === 'comparison') return rule.left.type === 'column' ? rule.left.columnId : firstColumn(columns);
  if (rule.type === 'expression') return firstColumn(columns);
  return firstColumn(columns);
}

function convertRuleType(rule: ValidationRule, type: EditableValidationRuleType, columns: readonly DatasetColumn[]): ValidationRule {
  const base = metadata(rule);
  const columnId = selectedColumn(rule, columns);
  switch (type) {
    case 'required': return { ...base, type, columnId };
    case 'type': return { ...base, type, columnId, valueType: rule.type === 'type' ? rule.valueType : 'string' };
    case 'allowed': return { ...base, type, columnId, allowedValues: rule.type === 'allowed' ? rule.allowedValues : [] };
    case 'numberRange': return { ...base, type, columnId, ...(rule.type === 'numberRange' ? { min: rule.min, max: rule.max } : {}) };
    case 'dateRange': return { ...base, type, columnId, ...(rule.type === 'dateRange' ? { min: rule.min, max: rule.max } : {}) };
    case 'stringLength': return { ...base, type, columnId, ...(rule.type === 'stringLength' ? { min: rule.min, max: rule.max } : {}) };
    case 'unique': return { ...base, type, columnId };
    case 'compositeUnique': return { ...base, type, columnIds: rule.type === 'compositeUnique' ? rule.columnIds : columnId ? [columnId] : [] };
    case 'comparison': return {
      ...base,
      type,
      left: rule.type === 'comparison' ? rule.left : { type: 'column', columnId },
      operator: rule.type === 'comparison' ? rule.operator : 'equals',
      right: rule.type === 'comparison' ? rule.right : { type: 'literal', value: null },
    };
    case 'expression': return { ...base, type, expression: rule.type === 'expression' ? rule.expression : defaultExpression(columns) };
    case 'reference': return {
      ...base,
      type,
      columnId,
      referenceColumnId: rule.type === 'reference' ? rule.referenceColumnId : columnId,
      mode: rule.type === 'reference' ? rule.mode : 'exists',
    };
  }
}

function displayValue(value: CellValue): string {
  return value === null ? '' : String(value);
}

function parseNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function targetField(rule: ValidationRule, columns: readonly DatasetColumn[], onChange: (columnId: string) => void) {
  if (!('columnId' in rule)) return null;
  return (
    <label>Coluna-alvo
      <select aria-label="Coluna-alvo" value={rule.columnId} onChange={(event) => onChange(event.currentTarget.value)}>
        {columns.map((column) => <option value={column.id} key={column.id}>{column.header}</option>)}
      </select>
    </label>
  );
}

export function ValidationRuleEditor({ dataset, columns, value, disabled, onSave, onCancel }: ValidationRuleEditorProps) {
  const [draft, setDraft] = useState<ValidationRule>(value);
  const [conversionNotice, setConversionNotice] = useState(false);

  useEffect(() => setDraft(value), [value]);

  const update = (next: Partial<ValidationRule>) => setDraft((current) => ({ ...current, ...next } as ValidationRule));
  const definitionType = draft.type as EditableValidationRuleType;
  const selectedTarget = useMemo(() => selectedColumn(draft, columns), [columns, draft]);

  const switchDefinition = (nextType: EditableValidationRuleType) => {
    if (nextType === draft.type) return;
    setDraft(convertRuleType(draft, nextType, columns));
    setConversionNotice(true);
  };

  return (
    <section className="validation-rule-editor" aria-label="Editor de regra">
      <label>Nome da regra
        <input value={draft.name ?? ''} onChange={(event) => update({ name: event.currentTarget.value })} placeholder="Ex.: Início antes do fim" />
      </label>
      <label>Tipo de definição
        <select aria-label="Tipo de definição" value={definitionType} disabled={disabled} onChange={(event) => switchDefinition(event.currentTarget.value as EditableValidationRuleType)}>
          {DEFINITION_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
      </label>
      {targetField(draft, columns, (columnId) => update({ columnId }))}
      <label>Severidade
        <select value={draft.severity ?? 'error'} onChange={(event) => update({ severity: event.currentTarget.value as 'error' | 'warning' })}>
          <option value="error">Erro</option>
          <option value="warning">Aviso</option>
        </select>
      </label>
      {draft.type === 'type' ? (
        <label>Tipo esperado
          <select value={draft.valueType} onChange={(event) => update({ valueType: event.currentTarget.value as typeof draft.valueType })}>
            <option value="string">Texto</option><option value="number">Número</option><option value="date">Data</option><option value="boolean">Booleano</option>
          </select>
        </label>
      ) : null}
      {draft.type === 'allowed' ? (
        <label>Valores permitidos
          <input aria-label="Valores permitidos" value={draft.allowedValues.map(displayValue).join(', ')} onChange={(event) => update({ allowedValues: event.currentTarget.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
        </label>
      ) : null}
      {draft.type === 'numberRange' || draft.type === 'dateRange' || draft.type === 'stringLength' ? (
        <div className="validation-range-fields">
          <label>Mínimo<input aria-label="Mínimo" type={draft.type === 'dateRange' ? 'date' : 'number'} value={draft.min === undefined ? '' : String(draft.min)} onChange={(event) => update({ min: (draft.type === 'dateRange' ? event.currentTarget.value || undefined : parseNumber(event.currentTarget.value)) } as Partial<ValidationRule>)} /></label>
          <label>Máximo<input aria-label="Máximo" type={draft.type === 'dateRange' ? 'date' : 'number'} value={draft.max === undefined ? '' : String(draft.max)} onChange={(event) => update({ max: (draft.type === 'dateRange' ? event.currentTarget.value || undefined : parseNumber(event.currentTarget.value)) } as Partial<ValidationRule>)} /></label>
        </div>
      ) : null}
      {draft.type === 'compositeUnique' ? (
        <label>Colunas da chave
          <select multiple value={draft.columnIds} onChange={(event) => update({ columnIds: [...event.currentTarget.selectedOptions].map((option) => option.value) })}>
            {columns.map((column) => <option value={column.id} key={column.id}>{column.header}</option>)}
          </select>
        </label>
      ) : null}
      {draft.type === 'comparison' ? (
        <div className="validation-comparison-fields">
          <label>Coluna esquerda
            <select aria-label="Coluna esquerda" value={draft.left.type === 'column' ? draft.left.columnId : selectedTarget} onChange={(event) => update({ left: { type: 'column', columnId: event.currentTarget.value } })}>
              {columns.map((column) => <option value={column.id} key={column.id}>{column.header}</option>)}
            </select>
          </label>
          <label>Operador de comparação
            <select aria-label="Operador de comparação" value={draft.operator} onChange={(event) => update({ operator: event.currentTarget.value as typeof draft.operator })}>
              <option value="equals">Igual a</option><option value="notEquals">Diferente de</option><option value="greaterThan">Maior que</option><option value="greaterThanOrEqual">Maior ou igual</option><option value="lessThan">Menor que</option><option value="lessThanOrEqual">Menor ou igual</option>
            </select>
          </label>
          <label>Tipo do valor direito
            <select aria-label="Tipo do valor direito" value={draft.right.type} onChange={(event) => update({ right: event.currentTarget.value === 'column' ? { type: 'column', columnId: firstColumn(columns) } : { type: 'literal', value: null } })}>
              <option value="literal">Valor</option><option value="column">Coluna</option>
            </select>
          </label>
          {draft.right.type === 'column' ? <label>Coluna direita
            <select aria-label="Coluna direita" value={draft.right.columnId} onChange={(event) => update({ right: { type: 'column', columnId: event.currentTarget.value } })}>
              {columns.map((column) => <option value={column.id} key={column.id}>{column.header}</option>)}
            </select>
          </label> : <label>Valor direito<input value={displayValue(draft.right.value)} onChange={(event) => update({ right: { type: 'literal', value: event.currentTarget.value } })} /></label>}
        </div>
      ) : null}
      {draft.type === 'expression' ? <ValidationExpressionBuilder dataset={dataset} value={draft.expression} disabled={disabled} onChange={(expression) => update({ expression })} /> : null}
      {draft.type === 'reference' ? (
        <div className="validation-reference-fields">
          <label>Coluna de referência
            <select value={draft.referenceColumnId} onChange={(event) => update({ referenceColumnId: event.currentTarget.value })}>
              {columns.map((column) => <option value={column.id} key={column.id}>{column.header}</option>)}
            </select>
          </label>
          <label>Regra da referência
            <select value={draft.mode} onChange={(event) => update({ mode: event.currentTarget.value as typeof draft.mode })}>
              <option value="exists">Deve existir</option><option value="notExists">Não deve existir</option>
            </select>
          </label>
        </div>
      ) : null}
      <ConditionBuilder dataset={dataset} value={draft.when as TransformConditionNode | undefined} disabled={disabled} onChange={(when) => update({ when })} />
      {conversionNotice ? <p className="form-help">A configuração anterior será preservada quando compatível.</p> : null}
      <div className="validation-editor-actions">
        <button type="button" disabled={disabled} onClick={() => onSave(draft)}>Salvar regra</button>
        <button type="button" disabled={disabled} onClick={onCancel}>Cancelar</button>
      </div>
    </section>
  );
}
