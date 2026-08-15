// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConditionalMatrixEditor } from '../../../src/app/components/ConditionalMatrixEditor';
import type { Dataset } from '../../../src/domain/dataset/types';
import type { ConditionalMatrixRule } from '../../../src/domain/validation/types';

const dataset: Dataset = {
  columns: [
    { id: 'context__1', header: 'Contexto', sourceIndex: 0, detectedType: 'string' },
    { id: 'value__1', header: 'Valor', sourceIndex: 1, detectedType: 'string' },
  ],
  rows: [
    {
      rowId: 'r-1',
      sourceRowNumber: 2,
      values: { context__1: 'A', value__1: 'X' },
      originalValues: { context__1: 'A', value__1: 'X' },
    },
    {
      rowId: 'r-2',
      sourceRowNumber: 3,
      values: { context__1: 'A', value__1: 'X' },
      originalValues: { context__1: 'A', value__1: 'X' },
    },
  ],
};

const rule: ConditionalMatrixRule = {
  type: 'conditionalMatrix',
  keyColumnIds: ['context__1'],
  dependentColumnIds: ['value__1'],
  entries: [],
};

describe('ConditionalMatrixEditor', () => {
  afterEach(() => cleanup());

  it('imports distinct dataset combinations into the direct matrix', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ConditionalMatrixEditor dataset={dataset} columns={dataset.columns} rule={rule} disabled={false} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Importar linhas distintas' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      entries: [{
        conditions: { context__1: { operator: 'equals', value: 'A' } },
        constraints: { value__1: { type: 'equals', value: 'X' } },
      }],
    }));
  });

  it('adds an editable matrix row without changing the source dataset', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ConditionalMatrixEditor dataset={dataset} columns={dataset.columns} rule={rule} disabled={false} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Adicionar linha' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      entries: [{
        conditions: { context__1: { operator: 'any' } },
        constraints: { value__1: { type: 'any' } },
      }],
    }));
    expect(dataset.rows[0].values).toEqual({ context__1: 'A', value__1: 'X' });
  });

  it('exibe os tipos de valor em português', () => {
    render(<ConditionalMatrixEditor
      dataset={dataset}
      columns={dataset.columns}
      rule={{
        ...rule,
        entries: [{
          conditions: { context__1: { operator: 'any' } },
          constraints: { value__1: { type: 'type', valueType: 'string' } },
        }],
      }}
      disabled={false}
      onChange={vi.fn()}
    />);

    expect(screen.getByRole('option', { name: 'Texto' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Número' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Data' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Booleano' })).toBeInTheDocument();
  });

  it('filtra linhas importadas e mantém o índice original ao editar', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const entries = [
      {
        conditions: { context__1: { operator: 'equals' as const, value: 'Cliente A' } },
        constraints: { value__1: { type: 'equals' as const, value: 'Valor A' } },
      },
      {
        conditions: { context__1: { operator: 'equals' as const, value: 'Cliente B' } },
        constraints: { value__1: { type: 'equals' as const, value: 'Valor B' } },
      },
    ];

    render(
      <ConditionalMatrixEditor
        dataset={dataset}
        columns={dataset.columns}
        rule={{ ...rule, entries }}
        disabled={false}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByRole('searchbox', { name: 'Pesquisar linhas da matriz' }), 'cliente b');

    expect(screen.getByDisplayValue('Cliente B')).toBeVisible();
    expect(screen.queryByDisplayValue('Cliente A')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Operador Contexto, linha 2' })).toBeVisible();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Regra Valor, linha 2' }), 'required');

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      entries: [entries[0], expect.objectContaining({
        constraints: { value__1: { type: 'required' } },
      })],
    }));
  });

  it('mantém o resumo de conflitos fora dos detalhes roláveis', () => {
    render(
      <ConditionalMatrixEditor
        dataset={dataset}
        columns={dataset.columns}
        rule={{
          ...rule,
          entries: [
            {
              conditions: { context__1: { operator: 'any' } },
              constraints: { value__1: { type: 'equals', value: 'A' } },
            },
            {
              conditions: { context__1: { operator: 'any' } },
              constraints: { value__1: { type: 'equals', value: 'B' } },
            },
          ],
        }}
        disabled={false}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('1 conflito encontrado.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Detalhes dos conflitos' })).toBeInTheDocument();
  });

  it('exibe estado vazio distinto de uma pesquisa sem resultados', () => {
    render(<ConditionalMatrixEditor dataset={dataset} columns={dataset.columns} rule={rule} disabled={false} onChange={vi.fn()} />);

    expect(screen.getByText('Nenhuma linha configurada.')).toBeInTheDocument();
  });

  it('edita metadados, política de não correspondência e exibe a prévia', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ConditionalMatrixEditor
      dataset={dataset}
      columns={dataset.columns}
      rule={{ ...rule, name: 'Contexto obrigatório', entries: [{ conditions: { context__1: { operator: 'equals', value: 'A' } }, constraints: { value__1: { type: 'required' } } }] }}
      disabled={false}
      onChange={onChange}
    />);

    await user.clear(screen.getByLabelText('Nome da matriz'));
    await user.type(screen.getByLabelText('Nome da matriz'), 'Matriz de contexto');
    await user.selectOptions(screen.getByLabelText('Severidade da matriz'), 'error');
    await user.selectOptions(screen.getByLabelText('Quando não houver correspondência'), 'ignore');

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'Matriz de contexto',
      severity: 'error',
      noMatchBehavior: 'ignore',
    }));
    expect(screen.getByText('2 linha(s) correspondem à prévia.')).toBeInTheDocument();
  });
});
