import React, { useEffect, useState } from 'react';
import type { CellValue, Dataset } from '../../domain/dataset/types';
import { getDistinctColumnValues } from '../../domain/transforms/transform-values';
import type {
  TransformConditionNode,
  TransformConditionOperand,
  TransformConditionOperator,
} from '../../domain/transforms/types';
import { ValuePicker } from './ValuePicker';

interface ConditionBuilderProps {
  dataset: Dataset;
  value?: TransformConditionNode;
  disabled?: boolean;
  required?: boolean;
  onChange(value?: TransformConditionNode): void;
}

interface ConditionGroupEditorProps {
  dataset: Dataset;
  group: Extract<TransformConditionNode, { type: 'group' }>;
  path: string;
  disabled: boolean;
  onChange(group: Extract<TransformConditionNode, { type: 'group' }>): void;
}

const OPERATORS: Array<{ value: TransformConditionOperator; label: string }> = [
  { value: 'equals', label: 'Igual a' },
  { value: 'notEquals', label: 'Diferente de' },
  { value: 'contains', label: 'Contém' },
  { value: 'isEmpty', label: 'Está vazio' },
  { value: 'notEmpty', label: 'Não está vazio' },
  { value: 'greaterThan', label: 'Maior que' },
  { value: 'greaterThanOrEqual', label: 'Maior ou igual a' },
  { value: 'lessThan', label: 'Menor que' },
  { value: 'lessThanOrEqual', label: 'Menor ou igual a' },
];

function firstValue(dataset: Dataset, columnId: string): CellValue {
  return getDistinctColumnValues(dataset, columnId)[0] ?? null;
}

function defaultPredicate(dataset: Dataset): Extract<TransformConditionNode, { type: 'predicate' }> {
  const columnId = dataset.columns[0]?.id ?? '';
  return {
    type: 'predicate',
    columnId,
    operator: 'equals',
    operand: { type: 'literal', value: firstValue(dataset, columnId) },
  };
}

function defaultGroup(dataset: Dataset): Extract<TransformConditionNode, { type: 'group' }> {
  return { type: 'group', operator: 'and', children: dataset.columns.length > 0 ? [defaultPredicate(dataset)] : [] };
}

function isValueOperator(operator: TransformConditionOperator): boolean {
  return operator !== 'isEmpty' && operator !== 'notEmpty';
}

function updateOperand(
  predicate: Extract<TransformConditionNode, { type: 'predicate' }>,
  operand: TransformConditionOperand,
): Extract<TransformConditionNode, { type: 'predicate' }> {
  return { ...predicate, operand };
}

function ConditionGroupEditor({ dataset, group, path, disabled, onChange }: ConditionGroupEditorProps) {
  const updateChild = (index: number, child: TransformConditionNode) => {
    onChange({ ...group, children: group.children.map((current, currentIndex) => currentIndex === index ? child : current) });
  };

  return (
    <fieldset className="condition-group">
      <legend>Grupo {path}</legend>
      <label className="field">Lógica do grupo{path === '1' ? '' : ` ${path}`}
        <select
          aria-label={path === '1' ? 'Lógica do grupo' : `Lógica do grupo ${path}`}
          value={group.operator}
          disabled={disabled}
          onChange={(event) => onChange({ ...group, operator: event.currentTarget.value as 'and' | 'or' })}
        >
          <option value="and">E</option>
          <option value="or">OU</option>
        </select>
      </label>
      {group.children.map((child, index) => child.type === 'group' ? (
        <ConditionGroupEditor
          key={`${path}-${index}`}
          dataset={dataset}
          group={child}
          path={`${path}.${index + 1}`}
          disabled={disabled}
          onChange={(next) => updateChild(index, next)}
        />
      ) : (
        <fieldset className="condition-row" key={`${path}-${index}`}>
          <legend>Condição {path}.{index + 1}</legend>
          <label className="field">Coluna da condição {path}.{index + 1}
            <select
              value={child.columnId}
              disabled={disabled}
              onChange={(event) => updateChild(index, {
                ...child,
                columnId: event.currentTarget.value,
                operand: { type: 'literal', value: firstValue(dataset, event.currentTarget.value) },
              })}
            >
              {dataset.columns.map((column) => <option value={column.id} key={column.id}>{column.header}</option>)}
            </select>
          </label>
          <label className="field">Operador da condição {path}.{index + 1}
            <select
              value={child.operator}
              disabled={disabled}
              onChange={(event) => updateChild(index, {
                ...child,
                operator: event.currentTarget.value as TransformConditionOperator,
                operand: isValueOperator(event.currentTarget.value as TransformConditionOperator)
                  ? child.operand ?? { type: 'literal', value: firstValue(dataset, child.columnId) }
                  : undefined,
              })}
            >
              {OPERATORS.map((operator) => <option value={operator.value} key={operator.value}>{operator.label}</option>)}
            </select>
          </label>
          {isValueOperator(child.operator) ? (
            <>
              <label className="field">Tipo de operando {path}.{index + 1}
                <select
                  value={child.operand?.type ?? 'literal'}
                  disabled={disabled}
                  onChange={(event) => updateChild(index, updateOperand(child, event.currentTarget.value === 'column'
                    ? { type: 'column', columnId: dataset.columns[0]?.id ?? child.columnId }
                    : { type: 'literal', value: firstValue(dataset, child.columnId) }))}
                >
                  <option value="literal">Valor</option>
                  <option value="column">Outra coluna</option>
                </select>
              </label>
              {child.operand?.type === 'column' ? (
                <label className="field">Coluna comparada {path}.{index + 1}
                  <select
                    value={child.operand.columnId}
                    disabled={disabled}
                    onChange={(event) => updateChild(index, updateOperand(child, { type: 'column', columnId: event.currentTarget.value }))}
                  >
                    {dataset.columns.map((column) => <option value={column.id} key={column.id}>{column.header}</option>)}
                  </select>
                </label>
              ) : (
                <ValuePicker
                  dataset={dataset}
                  columnId={child.columnId}
                  label={`Valor da condição ${path}.${index + 1}`}
                  value={child.operand?.value ?? null}
                  disabled={disabled}
                  onChange={(value) => updateChild(index, updateOperand(child, { type: 'literal', value }))}
                />
              )}
            </>
          ) : null}
          <button type="button" disabled={disabled || group.children.length <= 1} onClick={() => onChange({ ...group, children: group.children.filter((_, currentIndex) => currentIndex !== index) })}>
            Remover condição {path}.{index + 1}
          </button>
        </fieldset>
      ))}
      <div className="condition-actions">
        <button type="button" disabled={disabled || dataset.columns.length === 0} onClick={() => onChange({ ...group, children: [...group.children, defaultPredicate(dataset)] })}>
          Adicionar condição
        </button>
        <button type="button" disabled={disabled || dataset.columns.length === 0} onClick={() => onChange({ ...group, children: [...group.children, defaultGroup(dataset)] })}>
          Adicionar grupo
        </button>
      </div>
    </fieldset>
  );
}

export function ConditionBuilder({ dataset, value, disabled = false, required = false, onChange }: ConditionBuilderProps) {
  const [enabled, setEnabled] = useState(value !== undefined);

  useEffect(() => setEnabled(value !== undefined), [value]);
  useEffect(() => {
    if (required && value === undefined && dataset.columns.length > 0) onChange(defaultGroup(dataset));
  }, [dataset, onChange, required, value]);

  const group = value?.type === 'group' ? value : defaultGroup(dataset);
  return (
    <fieldset className="condition-builder">
      <legend>Condicionantes opcionais</legend>
      <label>
        <input
          type="checkbox"
          aria-label="Aplicar condicionantes"
          checked={enabled}
          disabled={disabled || dataset.columns.length === 0}
          onChange={(event) => {
            const nextEnabled = event.currentTarget.checked;
            setEnabled(nextEnabled);
            onChange(nextEnabled ? defaultGroup(dataset) : undefined);
          }}
        />
        Aplicar condicionantes
      </label>
      {enabled ? <ConditionGroupEditor dataset={dataset} group={group} path="1" disabled={disabled} onChange={onChange} /> : null}
    </fieldset>
  );
}
