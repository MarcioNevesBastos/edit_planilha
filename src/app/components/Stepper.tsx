import React from 'react';

export interface WorkflowStepDefinition {
  id: string;
  label: string;
}

interface StepperProps {
  steps: readonly WorkflowStepDefinition[];
  currentIndex: number;
  highestVisitedIndex: number;
  disabled?: boolean;
  onSelect(index: number): void;
}

export function Stepper({
  steps,
  currentIndex,
  highestVisitedIndex,
  disabled = false,
  onSelect,
}: StepperProps) {
  return (
    <nav aria-label="Etapas da preparação" className="stepper">
      <ol>
        {steps.map((step, index) => {
          const reachable = index <= highestVisitedIndex;
          return (
            <li key={step.id} data-state={index === currentIndex ? 'current' : reachable ? 'visited' : 'pending'}>
              <button
                type="button"
                aria-current={index === currentIndex ? 'step' : undefined}
                disabled={disabled || !reachable}
                onClick={() => onSelect(index)}
              >
                <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                {step.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
