// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValidationPanel } from '../../../src/app/components/ValidationPanel';
import type { Dataset } from '../../../src/domain/dataset/types';

const dataset: Dataset = {
  columns: [
    { id: 'context__1', header: 'Contexto', sourceIndex: 0, detectedType: 'string' },
    { id: 'value__1', header: 'Valor', sourceIndex: 1, detectedType: 'string' },
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
});
