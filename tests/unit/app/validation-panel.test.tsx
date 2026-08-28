// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValidationPanel } from '../../../src/app/components/ValidationPanel';
import type { Dataset } from '../../../src/domain/dataset/types';
import type { ValidationIssue } from '../../../src/domain/validation/types';

const dataset: Dataset = {
  columns: [
    { id: 'context__1', header: 'Contexto', sourceIndex: 0, detectedType: 'string' },
    { id: 'value__1', header: 'Valor', sourceIndex: 1, detectedType: 'string' },
    { id: 'code__1', header: 'Código', sourceIndex: 2, detectedType: 'string' },
  ],
  rows: [],
};

describe('ValidationPanel conditional matrices', () => {
  afterEach(() => cleanup());

  it('creates a matrix from the selected default key and dependent columns', async () => {
    const user = userEvent.setup();
    const onAddRule = vi.fn();

    render(
      <ValidationPanel
        dataset={dataset}
        columns={dataset.columns}
        detectedRules={[]}
        userRules={[]}
        issues={[]}
        onAddRule={onAddRule}
        onReplaceRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onRun={vi.fn()}
        onSelectIssue={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Adicionar matriz' }));

    expect(onAddRule).toHaveBeenCalledWith(expect.objectContaining({
      type: 'conditionalMatrix',
      keyColumnIds: ['context__1'],
      dependentColumnIds: ['value__1'],
      entries: [],
    }));
  });

  it('pesquisa as listas de colunas independentemente sem remover seleções', async () => {
    const user = userEvent.setup();

    render(
      <ValidationPanel
        dataset={dataset}
        columns={dataset.columns}
        detectedRules={[]}
        userRules={[]}
        issues={[]}
        onAddRule={vi.fn()}
        onReplaceRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onRun={vi.fn()}
        onSelectIssue={vi.fn()}
      />,
    );

    const keySearch = screen.getByRole('searchbox', { name: 'Pesquisar colunas-chave' });
    const dependentSearch = screen.getByRole('searchbox', { name: 'Pesquisar colunas dependentes' });
    const keyList = within(screen.getByRole('group', { name: 'Colunas-chave' }));
    const dependentList = within(screen.getByRole('group', { name: 'Colunas dependentes' }));

    await user.type(keySearch, 'codigo');
    expect(keyList.getByRole('checkbox', { name: 'Código' })).toBeVisible();
    expect(keyList.queryByRole('checkbox', { name: 'Contexto' })).not.toBeInTheDocument();

    await user.click(keyList.getByRole('checkbox', { name: 'Código' }));
    await user.type(dependentSearch, 'valor');

    expect(dependentList.getByRole('checkbox', { name: 'Valor' })).toBeVisible();
    expect(dependentList.queryByRole('checkbox', { name: 'Código' })).not.toBeInTheDocument();
    await user.clear(keySearch);

    expect(keyList.getByRole('checkbox', { name: 'Contexto' })).toBeChecked();
    expect(keyList.getByRole('checkbox', { name: 'Código' })).toBeChecked();
  });
});

describe('ValidationPanel issue list', () => {
  afterEach(() => cleanup());

  it('virtualizes large validation issue lists instead of mounting every issue', () => {
    const issues: ValidationIssue[] = Array.from({ length: 200 }, (_, index) => ({
      rowId: `row-${index}`,
      sourceRowNumber: index + 2,
      columnId: 'value__1',
      code: 'numberRange',
      value: index,
      message: `Falha ${index}`,
    }));

    render(
      <ValidationPanel
        dataset={dataset}
        columns={dataset.columns}
        detectedRules={[]}
        userRules={[]}
        issues={issues}
        onAddRule={vi.fn()}
        onReplaceRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onRun={vi.fn()}
        onSelectIssue={vi.fn()}
      />,
    );

    const issueList = screen.getByRole('region', { name: 'Erros de validação' });
    expect(issueList.querySelectorAll('button').length).toBeLessThan(issues.length);
    expect(screen.getByText('Falha 0')).toBeInTheDocument();
  });
});
