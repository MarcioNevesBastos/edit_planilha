import React, { useEffect, useMemo, useState } from 'react';
import type { CellValue, Dataset, DatasetColumn } from '../../domain/dataset/types';
import type { Expression, TransformConditionNode } from '../../domain/transforms/types';
import { ConditionBuilder } from './ConditionBuilder';
import { ValidationExpressionBuilder } from './ValidationExpressionBuilder';
import type { ValidationFormat, ValidationRule, ValidationRuleMetadata } from '../../domain/validation/types';

export type EditableValidationRuleType = Exclude<ValidationRule['type'], 'conditionalMatrix'>;

export interface ReferenceDatasetOption {
  id: string;
  label: string;
  kind: 'current' | 'source' | 'template';
  sheetName?: string;
  dataset: Dataset;
}

interface ValidationRuleEditorProps {
  dataset: Dataset;
  columns: readonly DatasetColumn[];
  value: ValidationRule;
  disabled: boolean;
  referenceSources?: readonly ReferenceDatasetOption[];
  onSave(rule: ValidationRule): void;
  onCancel(): void;
}

const DEFINITION_OPTIONS: Array<{ group: string; value: EditableValidationRuleType; label: string }> = [
  { group: 'Presença', value: 'required', label: 'Obrigatório' },
  { group: 'Presença', value: 'empty', label: 'Deve estar vazio' },
  { group: 'Tipo e formato', value: 'type', label: 'Tipo' },
  { group: 'Tipo e formato', value: 'integer', label: 'Número inteiro' },
  { group: 'Tipo e formato', value: 'numberPrecision', label: 'Precisão decimal' },
  { group: 'Tipo e formato', value: 'format', label: 'Formato' },
  { group: 'Listas', value: 'allowed', label: 'Lista permitida' },
  { group: 'Listas', value: 'notAllowed', label: 'Lista bloqueada' },
  { group: 'Intervalos', value: 'numberRange', label: 'Intervalo numérico' },
  { group: 'Intervalos', value: 'dateRange', label: 'Intervalo de datas' },
  { group: 'Intervalos', value: 'stringLength', label: 'Tamanho do texto' },
  { group: 'Unicidade', value: 'unique', label: 'Valor único' },
  { group: 'Unicidade', value: 'compositeUnique', label: 'Chave composta' },
  { group: 'Colunas', value: 'comparison', label: 'Comparação entre colunas' },
  { group: 'Avançado', value: 'expression', label: 'Expressão' },
  { group: 'Relacionamentos', value: 'reference', label: 'Referência simples' },
  { group: 'Relacionamentos', value: 'relation', label: 'Relacionamento entre registros' },
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
    case 'empty': return { type, columnId };
    case 'type': return { type, columnId, valueType: 'string' };
    case 'integer': return { type, columnId };
    case 'numberPrecision': return { type, columnId, decimalPlaces: 0 };
    case 'format': return { type, columnId, format: 'email' };
    case 'allowed': return { type, columnId, allowedValues: [] };
    case 'notAllowed': return { type, columnId, disallowedValues: [] };
    case 'numberRange': return { type, columnId };
    case 'dateRange': return { type, columnId };
    case 'stringLength': return { type, columnId };
    case 'unique': return { type, columnId };
    case 'compositeUnique': return { type, columnIds: columnId ? [columnId] : [] };
    case 'comparison': return { type, left: { type: 'column', columnId }, operator: 'equals', right: { type: 'literal', value: null } };
    case 'expression': return { type, expression: defaultExpression(columns) };
    case 'reference': return { type, columnId, referenceColumnId: columnId, mode: 'exists' };
    case 'relation': return { type, source: 'current', leftColumnIds: columnId ? [columnId] : [], rightColumnIds: columnId ? [columnId] : [], minMatches: 1 };
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
    case 'empty': return { ...base, type, columnId };
    case 'type': return { ...base, type, columnId, valueType: rule.type === 'type' ? rule.valueType : 'string' };
    case 'integer': return { ...base, type, columnId };
    case 'numberPrecision': return { ...base, type, columnId, decimalPlaces: rule.type === 'numberPrecision' ? rule.decimalPlaces : 0 };
    case 'format': return {
      ...base,
      type,
      columnId,
      format: rule.type === 'format' ? rule.format : 'email',
      ...(rule.type === 'format' ? { pattern: rule.pattern, prefix: rule.prefix, suffix: rule.suffix } : {}),
    };
    case 'allowed': return { ...base, type, columnId, allowedValues: rule.type === 'allowed' ? rule.allowedValues : [] };
    case 'notAllowed': return { ...base, type, columnId, disallowedValues: rule.type === 'notAllowed' ? rule.disallowedValues : [] };
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
    case 'relation': return rule.type === 'relation'
      ? { ...base, type, source: rule.source, leftColumnIds: rule.leftColumnIds, rightColumnIds: rule.rightColumnIds, minMatches: rule.minMatches, maxMatches: rule.maxMatches }
      : { ...base, type, source: 'current', leftColumnIds: columnId ? [columnId] : [], rightColumnIds: columnId ? [columnId] : [], minMatches: 1 };
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

function parseInteger(value: string): number | undefined {
  const parsed = parseNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
}

function parseListValue(value: string, column: DatasetColumn | undefined): CellValue {
  const trimmed = value.trim();
  if (column?.detectedType === 'number') {
    const number = Number(trimmed.replace(',', '.'));
    return Number.isFinite(number) ? number : trimmed;
  }
  if (column?.detectedType === 'boolean' && (trimmed === 'true' || trimmed === 'false')) return trimmed === 'true';
  return trimmed;
}

function groupedOptions(): Array<[string, Array<{ value: EditableValidationRuleType; label: string }>]> {
  return [...new Map(DEFINITION_OPTIONS.map((option) => [option.group, [] as Array<{ value: EditableValidationRuleType; label: string }>]))]
    .map(([group]) => [group, DEFINITION_OPTIONS.filter((option) => option.group === group)]);
}

type RelationCardinality = 'none' | 'atMostOne' | 'exactlyOne' | 'atLeastOne' | 'atLeastTwo' | 'custom';

function relationCardinality(rule: Extract<ValidationRule, { type: 'relation' }>): RelationCardinality {
  if (rule.minMatches === 0 && rule.maxMatches === 0) return 'none';
  if (rule.minMatches === 0 && rule.maxMatches === 1) return 'atMostOne';
  if (rule.minMatches === 1 && rule.maxMatches === 1) return 'exactlyOne';
  if (rule.minMatches === 1 && rule.maxMatches === undefined) return 'atLeastOne';
  if (rule.minMatches === 2 && rule.maxMatches === undefined) return 'atLeastTwo';
  return 'custom';
}

function relationBounds(cardinality: Exclude<RelationCardinality, 'custom'>): { minMatches: number; maxMatches?: number } {
  switch (cardinality) {
    case 'none': return { minMatches: 0, maxMatches: 0 };
    case 'atMostOne': return { minMatches: 0, maxMatches: 1 };
    case 'exactlyOne': return { minMatches: 1, maxMatches: 1 };
    case 'atLeastTwo': return { minMatches: 2 };
    case 'atLeastOne': return { minMatches: 1 };
  }
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

export function ValidationRuleEditor({ dataset, columns, value, disabled, referenceSources = [], onSave, onCancel }: ValidationRuleEditorProps) {
  const [draft, setDraft] = useState<ValidationRule>(value);
  const [conversionNotice, setConversionNotice] = useState(false);
  const [cardinalityOverride, setCardinalityOverride] = useState<RelationCardinality | null>(null);

  useEffect(() => {
    setDraft(value);
    setCardinalityOverride(null);
  }, [value]);

  const update = (next: Partial<ValidationRule>) => setDraft((current) => ({ ...current, ...next } as ValidationRule));
  const definitionType = draft.type as EditableValidationRuleType;
  const selectedTarget = useMemo(() => selectedColumn(draft, columns), [columns, draft]);
  const relationSources = useMemo<ReferenceDatasetOption[]>(() => [
    { id: 'current', label: 'Dados atuais', kind: 'current', dataset: { columns: [...columns], rows: dataset.rows } },
    ...referenceSources.filter(({ id }) => id !== 'current'),
  ], [columns, dataset.rows, referenceSources]);
  const selectedRelationSource = draft.type === 'relation'
    ? relationSources.find(({ id }) => id === draft.source) ?? relationSources[0]
    : undefined;

  const switchDefinition = (nextType: EditableValidationRuleType) => {
    if (nextType === draft.type) return;
    setDraft(convertRuleType(draft, nextType, columns));
    setCardinalityOverride(null);
    setConversionNotice(true);
  };

  const selectedCardinality = draft.type === 'relation'
    ? cardinalityOverride ?? relationCardinality(draft)
    : null;

  return (
    <section className="validation-rule-editor" aria-label="Editor de regra">
      <label>Nome da regra
        <input value={draft.name ?? ''} onChange={(event) => update({ name: event.currentTarget.value })} placeholder="Ex.: Início antes do fim" />
      </label>
      <label>Tipo de definição
        <select aria-label="Tipo de definição" value={definitionType} disabled={disabled} onChange={(event) => switchDefinition(event.currentTarget.value as EditableValidationRuleType)}>
          {groupedOptions().map(([group, options]) => <optgroup label={group} key={group}>
            {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </optgroup>)}
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
      {draft.type === 'integer' ? <p className="form-help">Aceita somente números sem casas decimais.</p> : null}
      {draft.type === 'numberPrecision' ? (
        <label>Casas decimais máximas
          <input aria-label="Casas decimais máximas" type="number" min="0" step="1" value={draft.decimalPlaces} onChange={(event) => update({ decimalPlaces: parseNumber(event.currentTarget.value) ?? 0 })} />
        </label>
      ) : null}
      {draft.type === 'format' ? (
        <>
          <label>Formato
            <select aria-label="Formato" value={draft.format} onChange={(event) => update({ format: event.currentTarget.value as ValidationFormat })}>
              <option value="email">E-mail</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="cep">CEP</option><option value="phone">Telefone</option><option value="prefix">Prefixo</option><option value="suffix">Sufixo</option><option value="regex">Padrão personalizado</option>
            </select>
          </label>
          {draft.format === 'prefix' ? <label>Prefixo<input aria-label="Prefixo" value={draft.prefix ?? ''} onChange={(event) => update({ prefix: event.currentTarget.value })} /></label> : null}
          {draft.format === 'suffix' ? <label>Sufixo<input aria-label="Sufixo" value={draft.suffix ?? ''} onChange={(event) => update({ suffix: event.currentTarget.value })} /></label> : null}
          {draft.format === 'regex' ? <label>Padrão personalizado<input aria-label="Padrão personalizado" value={draft.pattern ?? ''} maxLength={256} onChange={(event) => update({ pattern: event.currentTarget.value })} /></label> : null}
        </>
      ) : null}
      {draft.type === 'allowed' ? (
        <label>Valores permitidos
          <input aria-label="Valores permitidos" value={draft.allowedValues.map(displayValue).join(', ')} onChange={(event) => update({ allowedValues: event.currentTarget.value.split(',').map((item) => parseListValue(item, columns.find(({ id }) => id === selectedTarget))).filter((item) => item !== '') })} />
        </label>
      ) : null}
      {draft.type === 'notAllowed' ? (
        <label>Valores bloqueados
          <input aria-label="Valores bloqueados" value={draft.disallowedValues.map(displayValue).join(', ')} onChange={(event) => update({ disallowedValues: event.currentTarget.value.split(',').map((item) => parseListValue(item, columns.find(({ id }) => id === selectedTarget))).filter((item) => item !== '') })} />
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
      {draft.type === 'relation' ? (
        <div className="validation-relation-fields">
          <label>Fonte do relacionamento
            <select aria-label="Fonte do relacionamento" value={draft.source} onChange={(event) => {
              const source = relationSources.find(({ id }) => id === event.currentTarget.value);
              update({ source: event.currentTarget.value, rightColumnIds: source ? [firstColumn(source.dataset.columns)] : [] });
            }}>
              {relationSources.map((source) => <option value={source.id} key={source.id}>{source.label}</option>)}
            </select>
          </label>
          <label>Colunas atuais
            <select aria-label="Colunas atuais" multiple value={draft.leftColumnIds} onChange={(event) => update({ leftColumnIds: [...event.currentTarget.selectedOptions].map((option) => option.value) })}>
              {columns.map((column) => <option value={column.id} key={column.id}>{column.header}</option>)}
            </select>
          </label>
          <label>Colunas da fonte
            <select aria-label="Colunas da fonte" multiple value={draft.rightColumnIds} onChange={(event) => update({ rightColumnIds: [...event.currentTarget.selectedOptions].map((option) => option.value) })}>
              {(selectedRelationSource?.dataset.columns ?? []).map((column) => <option value={column.id} key={column.id}>{column.header}</option>)}
            </select>
          </label>
          <label>Cardinalidade
            <select aria-label="Cardinalidade" value={selectedCardinality ?? 'atLeastOne'} onChange={(event) => {
              const cardinality = event.currentTarget.value as RelationCardinality;
              setCardinalityOverride(cardinality);
              if (cardinality !== 'custom') update(relationBounds(cardinality));
            }}>
              <option value="none">Nenhuma correspondência</option>
              <option value="atMostOne">No máximo uma</option>
              <option value="exactlyOne">Exatamente uma</option>
              <option value="atLeastOne">Uma ou mais</option>
              <option value="atLeastTwo">Duas ou mais</option>
              <option value="custom">Personalizada</option>
            </select>
          </label>
          {selectedCardinality === 'custom' ? <>
            <label>Mínimo de correspondências
              <input aria-label="Mínimo de correspondências" type="number" min="0" step="1" value={draft.minMatches} onChange={(event) => update({ minMatches: parseInteger(event.currentTarget.value) ?? 0 })} />
            </label>
            <label>Máximo de correspondências
              <input aria-label="Máximo de correspondências" type="number" min="0" step="1" value={draft.maxMatches ?? ''} onChange={(event) => update({ maxMatches: parseInteger(event.currentTarget.value) })} />
            </label>
          </> : null}
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
