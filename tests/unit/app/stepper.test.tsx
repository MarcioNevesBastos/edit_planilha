// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Stepper, type WorkflowStepDefinition } from '../../../src/app/components/Stepper';

const steps: readonly WorkflowStepDefinition[] = [
  { id: 'source', label: 'Origem' },
  { id: 'template', label: 'Modelo' },
];

describe('Stepper', () => {
  it('orienta o usuário a deslizar para ver todas as etapas', () => {
    render(<Stepper steps={steps} currentIndex={0} highestVisitedIndex={0} onSelect={() => undefined} />);

    expect(screen.getByText('Deslize para ver as etapas')).toBeInTheDocument();
  });
});
