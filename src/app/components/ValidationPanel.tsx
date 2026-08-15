import React, { useState } from 'react';
import type { Dataset, DatasetColumn } from '../../domain/dataset/types';
import type { ConditionalMatrixRule, ValidationIssue, ValidationRule } from '../../domain/validation/types';
import { analyzeValidationRules } from '../../domain/validation/rule-analysis';
import { ConditionalMatrixEditor } from './ConditionalMatrixEditor';
import { SearchableChecklist } from './SearchableChecklist';
import { ValidationRuleTable } from './ValidationRuleTable';

interface ValidationPanelProps {
  dataset: Dataset;
  columns: readonly DatasetColumn[];
  detectedRules: readonly ValidationRule[];
  userRules: readonly ValidationRule[];
  issues: readonly ValidationIssue[];
  disabled?: boolean;
  onAddRule(rule: ValidationRule): void;
  onReplaceRule(index: number, rule: ValidationRule): void;
  onRemoveRule(index: number): void;
  onRun(): void;
  onSelectIssue(issue: ValidationIssue): void;
}

function ruleLabel(rule: ValidationRule, columns: readonly DatasetColumn[]): string {
  if (rule.type === 'conditionalMatrix') {
    const names = [...rule.keyColumnIds, ...rule.dependentColumnIds]
      .map((id) => columns.find((column) => column.id === id)?.header ?? id)
      .join(' + ');
    return `${names}: matriz condicional`;
  }
  if (rule.type === 'comparison') {
    const label = (operand: typeof rule.left) => operand.type === 'column'
      ? columns.find((column) => column.id === operand.columnId)?.header ?? operand.columnId
      : String(operand.value ?? 'vazio');
    return `${label(rule.left)} ${rule.operator} ${label(rule.right)}`;
  }
  if (rule.type === 'expression') return `${rule.name ?? 'Expressão'}: expressão segura`;
  if (rule.type === 'reference') {
    const source = columns.find((column) => column.id === rule.columnId)?.header ?? rule.columnId;
    const target = columns.find((column) => column.id === rule.referenceColumnId)?.header ?? rule.referenceColumnId;
    return `${source}: referência ${rule.mode === 'exists' ? 'existente em' : 'ausente em'} ${target}`;
  }
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
  dataset,
  columns,
  detectedRules,
  userRules,
  issues,
  disabled = false,
  onAddRule,
  onReplaceRule,
  onRemoveRule,
  onRun,
  onSelectIssue,
}: ValidationPanelProps) {
  const [matrixKeyColumnIds, setMatrixKeyColumnIds] = useState<string[]>(columns[0] ? [columns[0].id] : []);
  const [matrixDependentColumnIds, setMatrixDependentColumnIds] = useState<string[]>(columns[1] ? [columns[1].id] : []);
  const matrixRules = userRules.flatMap((rule, index) => rule.type === 'conditionalMatrix' ? [{ rule, index }] : []);
  const simpleRules = userRules.flatMap((rule, index) => rule.type === 'conditionalMatrix' ? [] : [{ rule, index }]);
  const configurationErrors = analyzeValidationRules(userRules, columns.map(({ id }) => id));

  const toggleColumn = (columnIds: string[], setColumnIds: (ids: string[]) => void, id: string) => {
    setColumnIds(columnIds.includes(id) ? columnIds.filter((current) => current !== id) : [...columnIds, id]);
  };

  const addMatrix = () => {
    if (matrixKeyColumnIds.length === 0 || matrixDependentColumnIds.length === 0) return;
    if (matrixKeyColumnIds.some((id) => matrixDependentColumnIds.includes(id))) return;
    const matrix: ConditionalMatrixRule = {
      type: 'conditionalMatrix',
      id: `conditional-matrix-${userRules.length + 1}`,
      keyColumnIds: matrixKeyColumnIds,
      dependentColumnIds: matrixDependentColumnIds,
      entries: [],
    };
    onAddRule(matrix);
  };

  return (
    <div className="validation-layout">
      <section className="panel-section">
        <h3>Regras detectadas</h3>
        <ul>{detectedRules.map((rule, index) => <li key={`${rule.type}-${index}`}>{ruleLabel(rule, columns)}</li>)}</ul>
      </section>
      <ValidationRuleTable
        dataset={dataset}
        columns={columns}
        rules={simpleRules.map(({ rule }) => rule)}
        issues={issues}
        disabled={disabled}
        onAddRule={onAddRule}
        onReplaceRule={(simpleIndex, rule) => onReplaceRule(simpleRules[simpleIndex]?.index ?? simpleIndex, rule)}
        onRemoveRule={(simpleIndex) => onRemoveRule(simpleRules[simpleIndex]?.index ?? simpleIndex)}
        onRun={onRun}
        configurationErrors={configurationErrors}
      />
      <section className="panel-section conditional-matrices-section">
        <h3>Validações condicionais</h3>
        <p className="selection-note">Escolha as colunas que definem o contexto e as colunas que receberão regras.</p>
        <div className="matrix-column-picker">
          <SearchableChecklist
            title="Colunas-chave"
            options={columns.map((column) => ({ id: column.id, label: column.header }))}
            selectedIds={matrixKeyColumnIds}
            disabled={disabled}
            onToggle={(id) => toggleColumn(matrixKeyColumnIds, setMatrixKeyColumnIds, id)}
          />
          <SearchableChecklist
            title="Colunas dependentes"
            options={columns.map((column) => ({ id: column.id, label: column.header }))}
            selectedIds={matrixDependentColumnIds}
            disabled={disabled}
            onToggle={(id) => toggleColumn(matrixDependentColumnIds, setMatrixDependentColumnIds, id)}
          />
        </div>
        <button
          type="button"
          disabled={disabled || matrixKeyColumnIds.length === 0 || matrixDependentColumnIds.length === 0 || matrixKeyColumnIds.some((id) => matrixDependentColumnIds.includes(id))}
          onClick={addMatrix}
        >
          Adicionar matriz
        </button>
        {matrixRules.map(({ rule, index }) => (
          <div className="conditional-matrix-card" key={rule.id ?? `matrix-${index}`}>
            <div className="matrix-card-heading">
              <strong>{ruleLabel(rule, columns)}</strong>
              <button type="button" disabled={disabled} onClick={() => onRemoveRule(index)}>Remover matriz</button>
            </div>
            <ConditionalMatrixEditor
              dataset={dataset}
              columns={columns}
              rule={rule}
              disabled={disabled}
              onChange={(next) => onReplaceRule(index, next)}
            />
          </div>
        ))}
      </section>
      {issues.length > 0 ? (
        <section className="issue-list" aria-label="Erros de validação">
          {issues.map((issue) => (
            <button type="button" className={issue.severity === 'warning' ? 'warning-issue' : undefined} key={`${issue.rowId}-${issue.columnId}-${issue.code}`} onClick={() => onSelectIssue(issue)}>
              <span>Linha {issue.sourceRowNumber}</span>
              <strong>{issue.severity === 'warning' ? 'Aviso · ' : ''}{columns.find(({ id }) => id === issue.columnId)?.header ?? issue.columnId}</strong>
              <span>{issue.message}</span>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}
