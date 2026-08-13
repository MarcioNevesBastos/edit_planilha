// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConditionBuilder } from '../../../src/app/components/ConditionBuilder';
import type { Dataset } from '../../../src/domain/dataset/types';
import type { TransformConditionNode } from '../../../src/domain/transforms/types';

const dataset: Dataset = {
  columns: [
    { id: 'status__1', header: 'Status', sourceIndex: 0, detectedType: 'string' },
    { id: 'amount__1', header: 'Amount', sourceIndex: 1, detectedType: 'number' },
  ],
  rows: [
    { rowId: '1', sourceRowNumber: 2, values: { status__1: 'Ativo', amount__1: 10 }, originalValues: {} },
    { rowId: '2', sourceRowNumber: 3, values: { status__1: 'Inativo', amount__1: 2 }, originalValues: {} },
  ],
};

const condition: TransformConditionNode = {
  type: 'group',
  operator: 'and',
  children: [{ type: 'predicate', columnId: 'status__1', operator: 'equals', operand: { type: 'literal', value: 'Ativo' } }],
};

describe('ConditionBuilder', () => {
  afterEach(() => cleanup());

  it('changes the group logic between E and OU', () => {
    const onChange = vi.fn();
    render(<ConditionBuilder dataset={dataset} value={condition} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Lógica do grupo'), { target: { value: 'or' } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'group', operator: 'or' }));
  });

  it('adds an optional condition group when enabled', () => {
    const onChange = vi.fn();
    render(<ConditionBuilder dataset={dataset} value={undefined} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Aplicar condicionantes'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'group', operator: 'and' }));
  });
});
