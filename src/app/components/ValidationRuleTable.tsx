import React, { useMemo, useState } from 'react';
import type { Dataset, DatasetColumn } from '../../domain/dataset/types';
import { validateDataset } from '../../domain/validation/validate-row';
import { getValidationRuleId } from '../../domain/validation/rule-analysis';
import type { ValidationConfigurationError, ValidationIssue, ValidationRule } from '../../domain/validation/types';
import { ValidationRuleEditor, createDefaultValidationRule } from './ValidationRuleEditor';

interface ValidationRuleTableProps {
  dataset: Dataset;
  columns: readonly DatasetColumn[];
  rules: readonly ValidationRule[];
  issues: readonly ValidationIssue[];
  disabled: boolean;
  onAddRule(rule: ValidationRule): void;
  onReplaceRule(index: number, rule: ValidationRule): void;
  onRemoveRule(index: number): void;
  onRun(): void;
  configurationErrors?: readonly ValidationConfigurationError[];
}

function columnName(id: string, columns: readonly DatasetColumn[]): string {
  return columns.find(({ id: currentId }) => currentId === id)?.header ?? id;
}

function ruleLabel(rule: ValidationRule, columns: readonly DatasetColumn[]): string {
  if (rule.type === 'comparison') return `${rule.left.type === 'column' ? columnName(rule.left.columnId, columns) : 'valor'} ${rule.operator} ${rule.right.type === 'column' ? columnName(rule.right.columnId, columns) : 'valor'}`;
  if (rule.type === 'expression') return 'Expressão segura';
  if (rule.type === 'reference') return `${columnName(rule.columnId, columns)} → ${columnName(rule.referenceColumnId, columns)}`;
  if (rule.type === 'conditionalMatrix') return 'Matriz condicional';
  const ids = rule.type === 'compositeUnique' ? rule.columnIds : [rule.columnId];
  return ids.map((id) => columnName(id, columns)).join(' + ');
}

function definitionLabel(rule: ValidationRule): string {
  switch (rule.type) {
    case 'required': return 'Obrigatório';
    case 'type': return `Tipo: ${rule.valueType}`;
    case 'allowed': return 'Lista permitida';
    case 'numberRange': return 'Intervalo numérico';
    case 'dateRange': return 'Intervalo de datas';
    case 'stringLength': return 'Tamanho do texto';
    case 'unique': return 'Único';
    case 'compositeUnique': return 'Chave composta';
    case 'comparison': return 'Comparação';
    case 'expression': return 'Expressão';
    case 'reference': return 'Referência';
    case 'conditionalMatrix': return 'Matriz';
  }
}

export function ValidationRuleTable({
  dataset,
  columns,
  rules,
  issues,
  disabled,
  onAddRule,
  onReplaceRule,
  onRemoveRule,
  onRun,
  configurationErrors = [],
}: ValidationRuleTableProps) {
  const [draft, setDraft] = useState<ValidationRule | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState<'all' | 'error' | 'warning'>('all');
  const preview = useMemo(() => validateDataset(dataset, rules), [dataset, rules]);
  const allConfigurationErrors = [...configurationErrors, ...(preview.configurationErrors ?? [])];
  const impact = preview.ruleImpact ?? {};
  const visibleRules = rules.flatMap((rule, index) => {
    const text = `${rule.name ?? ''} ${ruleLabel(rule, columns)} ${definitionLabel(rule)}`.toLocaleLowerCase();
    if (search.trim() !== '' && !text.includes(search.trim().toLocaleLowerCase())) return [];
    if (severity !== 'all' && (rule.severity ?? 'error') !== severity) return [];
    return [{ rule, index }];
  });

  const startNewRule = () => {
    setEditingIndex(null);
    setDraft(createDefaultValidationRule('required', columns));
  };

  const saveRule = (rule: ValidationRule) => {
    if (editingIndex === null) onAddRule({ ...rule, id: rule.id ?? `validation-${rules.length + 1}` });
    else onReplaceRule(editingIndex, rule);
    setDraft(null);
    setEditingIndex(null);
  };

  return (
    <section className="panel-section validation-rule-table-section">
      <div className="validation-table-heading">
        <div><h3>Regras adicionadas</h3><p className="selection-note">Configure uma regra por linha e abra o editor para detalhes.</p></div>
        <button type="button" disabled={disabled || columns.length === 0} onClick={startNewRule}>Adicionar regra</button>
      </div>
      <div className="validation-table-filters">
        <label>Pesquisar regras<input aria-label="Pesquisar regras" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></label>
        <label>Filtrar severidade<select aria-label="Filtrar severidade" value={severity} onChange={(event) => setSeverity(event.currentTarget.value as typeof severity)}><option value="all">Todas</option><option value="error">Erros</option><option value="warning">Avisos</option></select></label>
      </div>
      <div className="validation-rule-table-scroll">
        <table className="validation-rule-table" aria-label="Regras de validação">
          <thead><tr><th>Ativa</th><th>Nome</th><th>Alvo</th><th>Definição</th><th>Severidade</th><th>Ocorrências</th><th>Ações</th></tr></thead>
          <tbody>
            {visibleRules.map(({ rule, index }) => {
              const id = getValidationRuleId(rule, index);
              const count = impact[id]?.affectedCells ?? issues.filter((issue) => issue.ruleId === id).length;
              return <tr key={id}>
                <td>{rule.enabled === false ? 'Não' : 'Sim'}</td>
                <td>{rule.name ?? `Regra ${index + 1}`}</td>
                <td>{ruleLabel(rule, columns)}</td>
                <td>{definitionLabel(rule)}</td>
                <td>{rule.severity === 'warning' ? 'Aviso' : 'Erro'}</td>
                <td>{count}</td>
                <td><button type="button" disabled={disabled} onClick={() => { setEditingIndex(index); setDraft(rule); }}>Editar</button><button type="button" disabled={disabled} onClick={() => onRemoveRule(index)}>Remover</button></td>
              </tr>;
            })}
          </tbody>
        </table>
        {visibleRules.length === 0 ? <p>Nenhuma regra encontrada.</p> : null}
      </div>
      {draft ? <ValidationRuleEditor dataset={dataset} columns={columns} value={draft} disabled={disabled} onSave={saveRule} onCancel={() => { setDraft(null); setEditingIndex(null); }} /> : null}
      {allConfigurationErrors.length > 0 ? <div className="error-banner" role="alert"><strong>Corrija a configuração antes de executar.</strong>{allConfigurationErrors.map((error) => <p key={`${error.ruleId}-${error.message}`}>{error.message}</p>)}</div> : null}
      <div className="validation-impact-summary" aria-label="Prévia do impacto">
        <strong>Prévia do impacto</strong>
        <span>{new Set(issues.map(({ rowId }) => rowId)).size} linha(s) afetada(s)</span>
        <span>{issues.length} ocorrência(s) atual(is)</span>
        <strong>{issues.length === 0 ? 'Nenhum erro encontrado' : `${issues.length} erro(s) encontrado(s)`}</strong>
      </div>
      <button type="button" className="primary-button" disabled={disabled || allConfigurationErrors.length > 0} onClick={onRun}>Executar validação</button>
    </section>
  );
}
