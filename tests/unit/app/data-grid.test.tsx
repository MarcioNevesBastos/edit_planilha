// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGrid } from '../../../src/app/components/DataGrid';
import type { Dataset } from '../../../src/domain/dataset/types';

const dataset: Dataset = {
  columns: [{ id: 'status__1', header: 'Status', sourceIndex: 0, detectedType: 'string' }],
  rows: [
    { rowId: 'r-1', sourceRowNumber: 2, values: { status__1: 'A' }, originalValues: { status__1: 'A' } },
    { rowId: 'r-2', sourceRowNumber: 3, values: { status__1: 'B' }, originalValues: { status__1: 'B' } },
  ],
};

describe('DataGrid validation filters', () => {
  afterEach(() => cleanup());

  it('filters rows by rule and preserves multiple messages on one cell', async () => {
    const user = userEvent.setup();
    render(<DataGrid
      dataset={dataset}
      issues={[
        { rowId: 'r-1', sourceRowNumber: 2, columnId: 'status__1', code: 'a', value: 'A', message: 'Primeira falha', ruleId: 'rule-a' },
        { rowId: 'r-1', sourceRowNumber: 2, columnId: 'status__1', code: 'b', value: 'A', message: 'Segunda falha', ruleId: 'rule-b' },
        { rowId: 'r-2', sourceRowNumber: 3, columnId: 'status__1', code: 'a', value: 'B', message: 'Outra falha', ruleId: 'rule-a' },
      ]}
      onEdit={vi.fn()}
    />);

    expect(screen.getByTitle('Primeira falha | Segunda falha')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Filtrar regra'), 'rule-b');

    expect(screen.getByText('1 de 2 linhas')).toBeInTheDocument();
    expect(screen.getByTitle('Segunda falha')).toBeInTheDocument();
  });

  it('renders mutually exclusive tabs for all, invalid and valid rows', async () => {
    const user = userEvent.setup();
    render(<DataGrid
      dataset={dataset}
      issues={[
        { rowId: 'r-1', sourceRowNumber: 2, columnId: 'status__1', code: 'required', value: '', message: 'Erro' },
        { rowId: 'r-2', sourceRowNumber: 3, columnId: 'status__1', code: 'warning', value: 'B', message: 'Aviso', severity: 'warning' },
      ]}
      onEdit={vi.fn()}
    />);

    expect(screen.getByRole('tab', { name: /Todas/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('2 de 2 linhas')).toBeInTheDocument();
    expect(screen.getByLabelText('Contagem de linhas')).toHaveTextContent('1 linha com erro');
    expect(screen.getByLabelText('Contagem de linhas')).toHaveTextContent('1 linha válida');

    await user.click(screen.getByRole('tab', { name: /Com erro/ }));
    expect(screen.getByText('1 de 2 linhas')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('B')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Válidas/ }));
    expect(screen.getByText('1 de 2 linhas')).toBeInTheDocument();
    expect(screen.getByDisplayValue('B')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('A')).not.toBeInTheDocument();
  });

  it('supports controlled filters so the parent can preserve the selected tab', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(<DataGrid
      dataset={dataset}
      issues={[]}
      filters={{ view: 'valid', issueRule: 'all', issueSeverity: 'all' }}
      onFiltersChange={onFiltersChange}
      onEdit={vi.fn()}
    />);

    expect(screen.getByRole('tab', { name: /Válidas/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: /Todas/ }));
    expect(onFiltersChange).toHaveBeenCalledWith({ view: 'all', issueRule: 'all', issueSeverity: 'all' });
  });

  it('shows an empty state when combined filters have no matching valid rows', async () => {
    const user = userEvent.setup();
    render(<DataGrid
      dataset={dataset}
      issues={[{
        rowId: 'r-1', sourceRowNumber: 2, columnId: 'status__1', code: 'required', value: '', message: 'Erro',
      }]}
      onEdit={vi.fn()}
    />);

    await user.click(screen.getByRole('tab', { name: /Válidas/ }));
    await user.selectOptions(screen.getByLabelText('Filtrar severidade'), 'error');

    expect(screen.getByText('Nenhuma linha corresponde aos filtros selecionados.')).toBeInTheDocument();
    expect(screen.getByText('0 de 2 linhas')).toBeInTheDocument();
  });
});
