import React from 'react';
import type { CellValue, Dataset, DatasetColumn } from '../../domain/dataset/types';
import type { Expression } from '../../domain/transforms/types';

interface ValidationExpressionBuilderProps {
  dataset: Dataset;
  value: Expression;
  disabled: boolean;
  onChange(value: Expression): void;
}

const BINARY_OPERATORS: Array<Extract<Expression, { type: 'binary' }>['operator']> = [
  '+', '-', '*', '/', '==', '!=', '>', '>=', '<', '<=', 'and', 'or',
];

function displayValue(value: CellValue): string {
  return value === null ? '' : String(value);
}

function parseValue(value: string, column: DatasetColumn | undefined): CellValue {
  if (value.trim() === '') return null;
  if (column?.detectedType === 'number') {
    const number = Number(value.replace(',', '.'));
    return Number.isFinite(number) ? number : value;
  }
  if (column?.detectedType === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

function defaultExpression(dataset: Dataset): Expression {
  return {
    type: 'binary',
    operator: '==',
    left: { type: 'column', columnId: dataset.columns[0]?.id ?? '' },
    right: { type: 'literal', value: null },
  };
}

function OperandEditor({
  dataset,
  expression,
  label,
  disabled,
  onChange,
}: {
  dataset: Dataset;
  expression: Expression;
  label: string;
  disabled: boolean;
  onChange(value: Expression): void;
}) {
  const column = expression.type === 'column'
    ? dataset.columns.find(({ id }) => id === expression.columnId)
    : undefined;
  if (expression.type === 'binary' || expression.type === 'unary') {
    return <ExpressionNodeEditor dataset={dataset} expression={expression} label={label} disabled={disabled} onChange={onChange} />;
  }
  return (
    <fieldset className="validation-expression-operand">
      <legend>{label}</legend>
      <label>Tipo do operando
        <select
          aria-label={`Tipo do operando ${label}`}
          value={expression.type}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value === 'column'
            ? { type: 'column', columnId: dataset.columns[0]?.id ?? '' }
            : { type: 'literal', value: null })}
        >
          <option value="column">Coluna</option>
          <option value="literal">Valor</option>
        </select>
      </label>
      {expression.type === 'column' ? (
        <label>{label}
          <select value={expression.columnId} disabled={disabled} onChange={(event) => onChange({ type: 'column', columnId: event.currentTarget.value })}>
            {dataset.columns.map((current) => <option value={current.id} key={current.id}>{current.header}</option>)}
          </select>
        </label>
      ) : (
        <label>Valor {label}
          <input
            value={displayValue(expression.value)}
            disabled={disabled}
            onChange={(event) => onChange({ type: 'literal', value: parseValue(event.currentTarget.value, column) })}
          />
        </label>
      )}
    </fieldset>
  );
}

function ExpressionNodeEditor({
  dataset,
  expression,
  label,
  disabled,
  onChange,
}: {
  dataset: Dataset;
  expression: Expression;
  label: string;
  disabled: boolean;
  onChange(value: Expression): void;
}) {
  if (expression.type === 'unary') {
    return (
      <fieldset className="validation-expression-node">
        <legend>{label}</legend>
        <label>Operador unário
          <select value={expression.operator} disabled={disabled} onChange={(event) => onChange({ ...expression, operator: event.currentTarget.value as 'not' | 'negate' })}>
            <option value="not">NÃO</option>
            <option value="negate">Negar número</option>
          </select>
        </label>
        <OperandEditor dataset={dataset} expression={expression.operand} label={`${label} operando`} disabled={disabled} onChange={(operand) => onChange({ ...expression, operand })} />
      </fieldset>
    );
  }
  if (expression.type === 'binary') {
    return (
      <fieldset className="validation-expression-node">
        <legend>{label}</legend>
        <label>Operador da expressão
          <select value={expression.operator} disabled={disabled} onChange={(event) => onChange({ ...expression, operator: event.currentTarget.value as typeof expression.operator })}>
            {BINARY_OPERATORS.map((operator) => <option value={operator} key={operator}>{operator}</option>)}
          </select>
        </label>
        <div className="validation-expression-children">
          <OperandEditor dataset={dataset} expression={expression.left} label={`${label} esquerda`} disabled={disabled} onChange={(left) => onChange({ ...expression, left })} />
          <OperandEditor dataset={dataset} expression={expression.right} label={`${label} direita`} disabled={disabled} onChange={(right) => onChange({ ...expression, right })} />
        </div>
      </fieldset>
    );
  }
  return <OperandEditor dataset={dataset} expression={expression} label={label} disabled={disabled} onChange={onChange} />;
}

export function ValidationExpressionBuilder({ dataset, value, disabled, onChange }: ValidationExpressionBuilderProps) {
  return (
    <section className="validation-expression-builder" aria-label="Construtor de expressão">
      <ExpressionNodeEditor dataset={dataset} expression={value ?? defaultExpression(dataset)} label="Expressão" disabled={disabled} onChange={onChange} />
      <p className="form-help">A expressão usa somente colunas, valores e operadores seguros.</p>
    </section>
  );
}
