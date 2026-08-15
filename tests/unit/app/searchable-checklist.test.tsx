// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchableChecklist } from '../../../src/app/components/SearchableChecklist';

const options = [
  { id: 'customer', label: 'Cliente' },
  { id: 'region', label: 'Região' },
  { id: 'code', label: 'Código' },
];

describe('SearchableChecklist', () => {
  afterEach(() => cleanup());

  it('filtra parcialmente sem diferenciar maiúsculas ou acentos', async () => {
    const user = userEvent.setup();

    render(
      <SearchableChecklist
        title="Colunas-chave"
        options={options}
        selectedIds={['customer']}
        onToggle={vi.fn()}
      />,
    );

    await user.type(screen.getByRole('searchbox', { name: 'Pesquisar colunas-chave' }), 'REGIAO');

    expect(screen.getByRole('checkbox', { name: 'Região' })).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: 'Cliente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Código' })).not.toBeInTheDocument();
  });

  it('mantém seleções ocultas pelo filtro e informa quando não há resultados', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <SearchableChecklist
        title="Colunas-chave"
        options={options}
        selectedIds={['customer']}
        onToggle={onToggle}
      />,
    );

    const search = screen.getByRole('searchbox', { name: 'Pesquisar colunas-chave' });
    await user.type(search, 'inexistente');

    expect(screen.getByText('Nenhuma coluna encontrada.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Cliente' })).not.toBeInTheDocument();
    await user.clear(search);

    expect(screen.getByRole('checkbox', { name: 'Cliente' })).toBeChecked();
    expect(screen.getByText('3 resultados')).toBeInTheDocument();
  });
});
