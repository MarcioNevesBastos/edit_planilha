// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValidationRuleTable } from '../../../src/app/components/ValidationRuleTable';
import type { Dataset } from '../../../src/domain/dataset/types';

const dataset: Dataset = {
  columns: [
    { id: 'start__1', header: 'Início', sourceIndex: 0, detectedType: 'number' },
    { id: 'end__1', header: 'Fim', sourceIndex: 1, detectedType: 'number' },
  ],
  rows: [],
};

describe('ValidationRuleTable', () => {
  afterEach(() => cleanup());

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
});
