import React, { useState } from 'react';
import type { DatasetColumn } from '../../domain/dataset/types';
import type { ValidationIssue, ValidationRule } from '../../domain/validation/types';

interface ValidationPanelProps {
  columns: readonly DatasetColumn[];
  detectedRules: readonly ValidationRule[];
  userRules: readonly ValidationRule[];
  issues: readonly ValidationIssue[];
  disabled?: boolean;
  onAddRule(rule: ValidationRule): void;
  onRemoveRule(index: number): void;
  onRun(): void;
  onSelectIssue(issue: ValidationIssue): void;
}

function ruleLabel(rule: ValidationRule, columns: readonly DatasetColumn[]): string {
  const columnIds = rule.type === 'compositeUnique' ? rule.columnIds : [rule.columnId];
  const names = columnIds.map((id) => columns.find((column) => column.id === id)?.header ?? id).join(' + ');
  switch (rule.type) {
    case 'required': return `${names}: obrigatório`;
    case 'type': return `${names}: tipo ${rule.valueType}`;
    case 'allowed': return `${names}: lista permitida`;
    case 'numberRange': return `${names}: intervalo numérico`;
    case 'dateRange': return `${names}: intervalo de datas`;
    case 'stringLength': return `${names}: tamanho do texto`;
    case 'unique': return `${names}: valor único`;
    case 'compositeUnique': return `${names}: combinação única`;
  }
}

export function ValidationPanel({
  columns,
  detectedRules,
  userRules,
  issues,
  disabled = false,
  onAddRule,
  onRemoveRule,
  onRun,
  onSelectIssue,
}: ValidationPanelProps) {
  const [columnId, setColumnId] = useState(columns[0]?.id ?? '');
  const [ruleType, setRuleType] = useState<'required' | 'unique'>('required');

  return (
    <div className="validation-layout">
      <section className="panel-section">
        <h3>Regras detectadas</h3>
        <ul>{detectedRules.map((rule, index) => <li key={`${rule.type}-${index}`}>{ruleLabel(rule, columns)}</li>)}</ul>
      </section>
      <section className="panel-section">
        <h3>Regras adicionadas</h3>
        <div className="inline-form">
          <label>Coluna
            <select value={columnId} disabled={disabled} onChange={(event) => setColumnId(event.currentTarget.value)}>
              {columns.map((column) => <option value={column.id} key={column.id}>{column.header}</option>)}
            </select>
          </label>
          <label>Regra
            <select value={ruleType} disabled={disabled} onChange={(event) => setRuleType(event.currentTarget.value as 'required' | 'unique')}>
              <option value="required">Obrigatório</option>
              <option value="unique">Único</option>
            </select>
          </label>
          <button type="button" disabled={disabled || columnId === ''} onClick={() => onAddRule({ type: ruleType, columnId })}>
            Adicionar regra
          </button>
        </div>
        <ul>{userRules.map((rule, index) => (
          <li key={`${rule.type}-${index}`}>
            {ruleLabel(rule, columns)}
            <button type="button" disabled={disabled} onClick={() => onRemoveRule(index)}>Remover</button>
          </li>
        ))}</ul>
      </section>
      <div className="validation-run">
        <button type="button" className="primary-button" disabled={disabled} onClick={onRun}>Executar validação</button>
        <strong>{issues.length === 0 ? 'Nenhum erro encontrado' : `${issues.length} erro(s) encontrado(s)`}</strong>
      </div>
      {issues.length > 0 ? (
        <section className="issue-list" aria-label="Erros de validação">
          {issues.map((issue) => (
            <button type="button" key={`${issue.rowId}-${issue.columnId}-${issue.code}`} onClick={() => onSelectIssue(issue)}>
              <span>Linha {issue.sourceRowNumber}</span>
              <strong>{columns.find(({ id }) => id === issue.columnId)?.header ?? issue.columnId}</strong>
              <span>{issue.message}</span>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}
