import React from 'react';
import type { CellValue, Dataset, DatasetColumn } from '../../domain/dataset/types';
import { distinctMatrixEntries, validateConditionalMatrixRule } from '../../domain/validation/matrix';
import type {
  ConditionalConstraint,
  ConditionalMatrixEntry,
  ConditionalMatrixRule,
  MatrixCondition,
  ValidationValueType,
} from '../../domain/validation/types';

interface ConditionalMatrixEditorProps {
  dataset: Dataset;
  columns: readonly DatasetColumn[];
  rule: ConditionalMatrixRule;
  disabled: boolean;
  onChange(rule: ConditionalMatrixRule): void;
}

function displayValue(value: CellValue): string {
  return value === null ? '' : String(value);
}

function parseValue(value: string, column: DatasetColumn): CellValue {
  if (value.trim() === '') return '';
  if (column.detectedType === 'number') {
    const number = Number(value.replace(',', '.'));
    return Number.isFinite(number) ? number : value;
  }
  if (column.detectedType === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

function defaultEntry(rule: ConditionalMatrixRule): ConditionalMatrixEntry {
  return {
    conditions: Object.fromEntries(rule.keyColumnIds.map((columnId) => [columnId, { operator: 'any' as const }])),
    constraints: Object.fromEntries(rule.dependentColumnIds.map((columnId) => [columnId, { type: 'any' as const }])),
  };
}

function constraintLabel(constraint: ConditionalConstraint): string {
  switch (constraint.type) {
    case 'any': return 'Sem regra';
    case 'required': return 'Obrigatório';
    case 'empty': return 'Vazio';
    case 'equals': return 'Valor exato';
    case 'allowed': return 'Lista permitida';
    case 'type': return `Tipo: ${constraint.valueType}`;
    case 'numberRange': return 'Intervalo numérico';
    case 'dateRange': return 'Intervalo de datas';
    case 'stringLength': return 'Tamanho do texto';
    case 'unique': return 'Único no contexto';
    case 'compositeUnique': return 'Chave composta no contexto';
  }
}

function parseOptionalNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function constraintTypeOptions(): Array<{ value: ConditionalConstraint['type']; label: string }> {
  return [
    { value: 'any', label: 'Sem regra' },
    { value: 'required', label: 'Obrigatório' },
    { value: 'equals', label: 'Valor exato' },
    { value: 'empty', label: 'Vazio' },
    { value: 'allowed', label: 'Lista permitida' },
    { value: 'type', label: 'Tipo' },
    { value: 'numberRange', label: 'Intervalo numérico' },
    { value: 'dateRange', label: 'Intervalo de datas' },
    { value: 'stringLength', label: 'Tamanho do texto' },
    { value: 'unique', label: 'Único no contexto' },
    { value: 'compositeUnique', label: 'Chave composta no contexto' },
  ];
}

export function ConditionalMatrixEditor({
  dataset,
  columns,
  rule,
  disabled,
  onChange,
}: ConditionalMatrixEditorProps) {
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const errors = validateConditionalMatrixRule(rule, columns.map(({ id }) => id));

  const updateEntry = (entryIndex: number, update: (entry: ConditionalMatrixEntry) => ConditionalMatrixEntry) => {
    onChange({ ...rule, entries: rule.entries.map((entry, index) => index === entryIndex ? update(entry) : entry) });
  };

  const updateCondition = (entryIndex: number, columnId: string, condition: MatrixCondition) => {
    updateEntry(entryIndex, (entry) => ({
      ...entry,
      conditions: { ...entry.conditions, [columnId]: condition },
    }));
  };

  const updateConstraint = (entryIndex: number, columnId: string, constraint: ConditionalConstraint) => {
    updateEntry(entryIndex, (entry) => ({
      ...entry,
      constraints: { ...entry.constraints, [columnId]: constraint },
    }));
  };

  const importDistinctEntries = () => {
    const imported = distinctMatrixEntries(dataset, rule.keyColumnIds, rule.dependentColumnIds);
    const existing = new Set(rule.entries.map((entry) => JSON.stringify(entry)));
    onChange({
      ...rule,
      entries: [...rule.entries, ...imported.filter((entry) => !existing.has(JSON.stringify(entry)))],
    });
  };

  return (
    <section className="conditional-matrix-editor" aria-label="Editor de matriz condicional">
      <div className="matrix-toolbar">
        <div>
          <strong>Relacionar colunas</strong>
          <p className="selection-note">Todas as condições da linha precisam ser verdadeiras.</p>
        </div>
        <div className="matrix-actions">
          <button type="button" disabled={disabled} onClick={importDistinctEntries}>Importar linhas distintas</button>
          <button type="button" disabled={disabled} onClick={() => onChange({ ...rule, entries: [...rule.entries, defaultEntry(rule)] })}>Adicionar linha</button>
        </div>
      </div>
      {errors.length > 0 ? (
        <div className="error-banner" role="alert">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      ) : null}
      <div className="conditional-matrix-scroll">
        <table className="conditional-matrix-table">
          <thead>
            <tr>
              <th colSpan={rule.keyColumnIds.length}>Condições</th>
              <th colSpan={rule.dependentColumnIds.length}>Consequências</th>
              <th aria-label="Ações" />
            </tr>
            <tr>
              {rule.keyColumnIds.map((columnId) => <th key={`key-${columnId}`}>{columnById.get(columnId)?.header ?? columnId}</th>)}
              {rule.dependentColumnIds.map((columnId) => <th key={`dependent-${columnId}`}>{columnById.get(columnId)?.header ?? columnId}</th>)}
              <th aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {rule.entries.map((entry, entryIndex) => (
              <tr key={`matrix-entry-${entryIndex}`}>
                {rule.keyColumnIds.map((columnId) => {
                  const condition = entry.conditions[columnId] ?? { operator: 'any' as const };
                  const column = columnById.get(columnId) ?? columns[0];
                  return (
                    <td key={columnId}>
                      <select
                        aria-label={`Operador ${column?.header ?? columnId}, linha ${entryIndex + 1}`}
                        value={condition.operator}
                        disabled={disabled}
                        onChange={(event) => {
                          const operator = event.currentTarget.value as MatrixCondition['operator'];
                          updateCondition(entryIndex, columnId, operator === 'equals'
                            ? { operator, value: column ? parseValue('', column) : '' }
                            : { operator });
                        }}
                      >
                        <option value="any">Qualquer</option>
                        <option value="equals">Igual a</option>
                        <option value="empty">Vazio</option>
                      </select>
                      {condition.operator === 'equals' ? (
                        <input
                          aria-label={`Valor ${column?.header ?? columnId}, linha ${entryIndex + 1}`}
                          value={displayValue(condition.value)}
                          disabled={disabled}
                          onChange={(event) => updateCondition(entryIndex, columnId, { operator: 'equals', value: column ? parseValue(event.currentTarget.value, column) : event.currentTarget.value })}
                        />
                      ) : null}
                    </td>
                  );
                })}
                {rule.dependentColumnIds.map((columnId) => {
                  const constraint = entry.constraints[columnId] ?? { type: 'any' as const };
                  const column = columnById.get(columnId) ?? columns[0];
                  return (
                    <td key={columnId}>
                      <select
                        aria-label={`Regra ${column?.header ?? columnId}, linha ${entryIndex + 1}`}
                        value={constraint.type}
                        disabled={disabled}
                        onChange={(event) => {
                          const type = event.currentTarget.value as ConditionalConstraint['type'];
                          const next: ConditionalConstraint = type === 'type'
                            ? { type, valueType: 'string' }
                            : type === 'allowed'
                              ? { type, allowedValues: [] }
                              : type === 'numberRange' || type === 'dateRange' || type === 'stringLength'
                                ? { type }
                                : type === 'equals'
                                  ? { type, value: column ? parseValue('', column) : '' }
                                  : type === 'compositeUnique'
                                    ? { type, columnIds: rule.dependentColumnIds }
                                    : { type };
                          updateConstraint(entryIndex, columnId, next);
                        }}
                      >
                        {constraintTypeOptions().map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                      </select>
                      <ConstraintEditor
                        column={column}
                        constraint={constraint}
                        disabled={disabled}
                        onChange={(next) => updateConstraint(entryIndex, columnId, next)}
                      />
                    </td>
                  );
                })}
                <td>
                  <button type="button" disabled={disabled} onClick={() => onChange({ ...rule, entries: rule.entries.filter((_, index) => index !== entryIndex) })}>
                    Remover
                  </button>
                </td>
              </tr>
            ))}
            {rule.entries.length === 0 ? <tr><td colSpan={rule.keyColumnIds.length + rule.dependentColumnIds.length + 1}>Nenhuma linha configurada.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="selection-note">{rule.entries.length} linha(s) configurada(s).</p>
    </section>
  );
}

interface ConstraintEditorProps {
  column: DatasetColumn | undefined;
  constraint: ConditionalConstraint;
  disabled: boolean;
  onChange(constraint: ConditionalConstraint): void;
}

function ConstraintEditor({ column, constraint, disabled, onChange }: ConstraintEditorProps) {
  if (constraint.type === 'equals') {
    return (
      <input
        aria-label="Valor esperado"
        value={displayValue(constraint.value)}
        disabled={disabled}
        onChange={(event) => onChange({ type: 'equals', value: column ? parseValue(event.currentTarget.value, column) : event.currentTarget.value })}
      />
    );
  }
  if (constraint.type === 'allowed') {
    return (
      <input
        aria-label="Valores permitidos"
        placeholder="valor1, valor2"
        value={constraint.allowedValues.map(displayValue).join(', ')}
        disabled={disabled}
        onChange={(event) => onChange({ type: 'allowed', allowedValues: event.currentTarget.value.split(',').map((value) => value.trim()).filter(Boolean) })}
      />
    );
  }
  if (constraint.type === 'type') {
    return (
      <select aria-label="Tipo esperado" value={constraint.valueType} disabled={disabled} onChange={(event) => onChange({ type: 'type', valueType: event.currentTarget.value as ValidationValueType })}>
        {(['string', 'number', 'date', 'boolean'] as const).map((valueType) => <option value={valueType} key={valueType}>{valueType}</option>)}
      </select>
    );
  }
  if (constraint.type === 'numberRange' || constraint.type === 'dateRange' || constraint.type === 'stringLength') {
    const isNumber = constraint.type === 'numberRange' || constraint.type === 'stringLength';
    const updateMinimum = (value: string) => {
      if (constraint.type === 'dateRange') {
        onChange({ ...constraint, min: value || undefined });
      } else {
        onChange({ ...constraint, min: parseOptionalNumber(value) });
      }
    };
    const updateMaximum = (value: string) => {
      if (constraint.type === 'dateRange') {
        onChange({ ...constraint, max: value || undefined });
      } else {
        onChange({ ...constraint, max: parseOptionalNumber(value) });
      }
    };
    return (
      <span className="matrix-range-fields">
        <input
          aria-label="Mínimo"
          type={isNumber ? 'number' : 'text'}
          placeholder="mínimo"
          value={constraint.min === undefined ? '' : String(constraint.min)}
          disabled={disabled}
          onChange={(event) => updateMinimum(event.currentTarget.value)}
        />
        <input
          aria-label="Máximo"
          type={isNumber ? 'number' : 'text'}
          placeholder="máximo"
          value={constraint.max === undefined ? '' : String(constraint.max)}
          disabled={disabled}
          onChange={(event) => updateMaximum(event.currentTarget.value)}
        />
      </span>
    );
  }
  return <small>{constraintLabel(constraint)}</small>;
}
