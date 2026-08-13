// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ValuePicker } from '../../../src/app/components/ValuePicker';
import type { Dataset } from '../../../src/domain/dataset/types';

const dataset: Dataset = {
  columns: [{ id: 'status__1', header: 'Status', sourceIndex: 0, detectedType: 'string' }],
  rows: [
    { rowId: '1', sourceRowNumber: 2, values: { status__1: 'Ativo' }, originalValues: {} },
    { rowId: '2', sourceRowNumber: 3, values: { status__1: '' }, originalValues: {} },
    { rowId: '3', sourceRowNumber: 4, values: { status__1: null }, originalValues: {} },
  ],
};

describe('ValuePicker', () => {
  it('offers distinct values and preserves the selected value type', () => {
    const onChange = vi.fn();
    render(<ValuePicker dataset={dataset} columnId="status__1" label="Localizar" value={null} onChange={onChange} />);

    expect(screen.getByRole('option', { name: 'Ativo' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Vazio' })).toBeInTheDocument();
    const option = screen.getByRole('option', { name: 'Ativo' });
    fireEvent.change(screen.getByLabelText('Sugestões para Localizar'), { target: { value: option.getAttribute('value') } });

    expect(onChange).toHaveBeenCalledWith('Ativo');
  });

  it('accepts a free value when no suggestion is selected', () => {
    const onChange = vi.fn();
    render(<ValuePicker dataset={dataset} columnId="status__1" label="Substituir por" value={null} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Substituir por'), { target: { value: 'Pendente' } });

    expect(onChange).toHaveBeenCalledWith('Pendente');
  });
});
