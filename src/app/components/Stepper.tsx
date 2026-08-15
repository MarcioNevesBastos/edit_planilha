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
  lockedIndices?: ReadonlySet<number>;
  onSelect(index: number): void;
}

export function Stepper({
  steps,
  currentIndex,
  highestVisitedIndex,
  disabled = false,
  lockedIndices = new Set(),
  onSelect,
}: StepperProps) {
  return (
    <nav aria-label="Etapas da preparação" className="stepper">
      <ol>
        {steps.map((step, index) => {
          const reachable = index <= highestVisitedIndex;
          const locked = lockedIndices.has(index);
          return (
            <li key={step.id} data-state={locked ? 'automatic' : index === currentIndex ? 'current' : reachable ? 'visited' : 'pending'}>
              <button
                type="button"
                aria-current={index === currentIndex ? 'step' : undefined}
                disabled={disabled || locked || !reachable}
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
