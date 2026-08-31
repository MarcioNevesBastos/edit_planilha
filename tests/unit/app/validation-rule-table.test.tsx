// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValidationRuleTable } from '../../../src/app/components/ValidationRuleTable';
import type { Dataset } from '../../../src/domain/dataset/types';
import type { ReferenceDatasetOption } from '../../../src/app/components/ValidationRuleEditor';

const dataset: Dataset = {
  columns: [
    { id: 'start__1', header: 'Início', sourceIndex: 0, detectedType: 'number' },
    { id: 'end__1', header: 'Fim', sourceIndex: 1, detectedType: 'number' },
  ],
  rows: [],
};

const referenceSources: ReferenceDatasetOption[] = [{
  id: 'template:Catalogo',
  label: 'Modelo · Catálogo',
  kind: 'template',
  sheetName: 'Catalogo',
  dataset: {
    columns: [{ id: 'catalog_code__1', header: 'Código', sourceIndex: 0, detectedType: 'string' }],
    rows: [],
  },
}];

const populatedDataset: Dataset = {
  ...dataset,
  rows: [
    { rowId: 'r-1', sourceRowNumber: 2, values: { start__1: 1, end__1: 2 }, originalValues: { start__1: 1, end__1: 2 } },
    { rowId: 'r-2', sourceRowNumber: 3, values: { start__1: null, end__1: 2 }, originalValues: { start__1: null, end__1: 2 } },
    { rowId: 'r-3', sourceRowNumber: 4, values: { start__1: 3, end__1: 4 }, originalValues: { start__1: 3, end__1: 4 } },
  ],
};

describe('ValidationRuleTable', () => {
  afterEach(() => cleanup());

  it('shows recalculated errors and valid rows for export before validation runs', () => {
    render(
      <ValidationRuleTable
        dataset={populatedDataset}
        columns={populatedDataset.columns}
        rules={[{ id: 'required-start', type: 'required', columnId: 'start__1' }]}
        issues={[]}
        disabled={false}
        onAddRule={vi.fn()}
        onReplaceRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    const impact = screen.getByText('Prévia do impacto').parentElement;
    expect(within(impact!).getByText('2 linha(s) válida(s) para exportação')).toBeInTheDocument();
    expect(within(impact!).getByText('1 erro(s) encontrado(s)')).toBeInTheDocument();
  });

  it('creates a same-row comparison from the table editor', async () => {
    const user = userEvent.setup();
    const onAddRule = vi.fn();

    render(
      <ValidationRuleTable
        dataset={dataset}
        columns={dataset.columns}
        rules={[]}
        issues={[]}
        disabled={false}
        onAddRule={onAddRule}
        onReplaceRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Adicionar regra' }));
    await user.selectOptions(screen.getByLabelText('Tipo de definição'), 'comparison');
    await user.selectOptions(screen.getByLabelText('Coluna esquerda'), 'start__1');
    await user.selectOptions(screen.getByLabelText('Operador de comparação'), 'lessThanOrEqual');
    await user.selectOptions(screen.getByLabelText('Tipo do valor direito'), 'column');
    await user.selectOptions(screen.getByLabelText('Coluna direita'), 'end__1');
    await user.click(screen.getByRole('button', { name: 'Salvar regra' }));

    expect(onAddRule).toHaveBeenCalledWith(expect.objectContaining({
      type: 'comparison',
      left: { type: 'column', columnId: 'start__1' },
      operator: 'lessThanOrEqual',
      right: { type: 'column', columnId: 'end__1' },
    }));
  });

  it('keeps the selected target when changing the definition type', async () => {
    const user = userEvent.setup();
    render(
      <ValidationRuleTable
        dataset={dataset}
        columns={dataset.columns}
        rules={[]}
        issues={[]}
        disabled={false}
        onAddRule={vi.fn()}
        onReplaceRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Adicionar regra' }));
    await user.selectOptions(screen.getByLabelText('Coluna-alvo'), 'end__1');
    await user.selectOptions(screen.getByLabelText('Tipo de definição'), 'numberRange');

    expect(screen.getByLabelText('Coluna-alvo')).toHaveValue('end__1');
    expect(screen.getByText('A configuração anterior será preservada quando compatível.')).toBeInTheDocument();
  });

  it('creates an integer rule from the grouped definition selector', async () => {
    const user = userEvent.setup();
    const onAddRule = vi.fn();
    render(
      <ValidationRuleTable
        dataset={dataset}
        columns={dataset.columns}
        rules={[]}
        issues={[]}
        disabled={false}
        onAddRule={onAddRule}
        onReplaceRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Adicionar regra' }));
    expect(screen.getByRole('group', { name: 'Tipo e formato' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Tipo de definição'), 'integer');
    await user.click(screen.getByRole('button', { name: 'Salvar regra' }));

    expect(onAddRule).toHaveBeenCalledWith(expect.objectContaining({ type: 'integer', columnId: 'start__1' }));
  });

  it('parses allowed values using the selected column type', async () => {
    const user = userEvent.setup();
    const onAddRule = vi.fn();
    render(
      <ValidationRuleTable
        dataset={dataset}
        columns={dataset.columns}
        rules={[]}
        issues={[]}
        disabled={false}
        onAddRule={onAddRule}
        onReplaceRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Adicionar regra' }));
    await user.selectOptions(screen.getByLabelText('Tipo de definição'), 'allowed');
    await user.selectOptions(screen.getByLabelText('Coluna-alvo'), 'start__1');
    await user.type(screen.getByLabelText('Valores permitidos'), '1, 2');
    await user.click(screen.getByRole('button', { name: 'Salvar regra' }));

    expect(onAddRule).toHaveBeenCalledWith(expect.objectContaining({ allowedValues: [1, 2] }));
  });

  it('creates a relationship with an external source and exact cardinality', async () => {
    const user = userEvent.setup();
    const onAddRule = vi.fn();
    render(
      <ValidationRuleTable
        dataset={dataset}
        columns={dataset.columns}
        rules={[]}
        issues={[]}
        disabled={false}
        referenceSources={referenceSources}
        onAddRule={onAddRule}
        onReplaceRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Adicionar regra' }));
    await user.selectOptions(screen.getByLabelText('Tipo de definição'), 'relation');
    await user.selectOptions(screen.getByLabelText('Fonte do relacionamento'), 'template:Catalogo');
    await user.selectOptions(screen.getByLabelText('Colunas atuais'), ['start__1']);
    await user.selectOptions(screen.getByLabelText('Colunas da fonte'), ['catalog_code__1']);
    await user.selectOptions(screen.getByLabelText('Cardinalidade'), 'exactlyOne');
    await user.click(screen.getByRole('button', { name: 'Salvar regra' }));

    expect(onAddRule).toHaveBeenCalledWith(expect.objectContaining({
      type: 'relation',
      source: 'template:Catalogo',
      leftColumnIds: ['start__1'],
      rightColumnIds: ['catalog_code__1'],
      minMatches: 1,
      maxMatches: 1,
    }));
  });

  it('supports a custom relationship cardinality', async () => {
    const user = userEvent.setup();
    const onAddRule = vi.fn();
    render(
      <ValidationRuleTable
        dataset={dataset}
        columns={dataset.columns}
        rules={[]}
        issues={[]}
        disabled={false}
        referenceSources={referenceSources}
        onAddRule={onAddRule}
        onReplaceRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Adicionar regra' }));
    await user.selectOptions(screen.getByLabelText('Tipo de definição'), 'relation');
    await user.selectOptions(screen.getByLabelText('Cardinalidade'), 'custom');
    await user.clear(screen.getByLabelText('Mínimo de correspondências'));
    await user.type(screen.getByLabelText('Mínimo de correspondências'), '2');
    await user.clear(screen.getByLabelText('Máximo de correspondências'));
    await user.type(screen.getByLabelText('Máximo de correspondências'), '4');
    await user.click(screen.getByRole('button', { name: 'Salvar regra' }));

    expect(onAddRule).toHaveBeenCalledWith(expect.objectContaining({ minMatches: 2, maxMatches: 4 }));
  });
});
