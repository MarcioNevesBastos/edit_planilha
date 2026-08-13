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
});
