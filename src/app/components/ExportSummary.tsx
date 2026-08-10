import React from 'react';
import type { WritePlan } from '../../domain/merge/types';

interface ExportSummaryProps {
  plan: WritePlan;
  validationRejected: number;
}

export function ExportSummary({ plan, validationRejected }: ExportSummaryProps) {
  const counts = [
    ['Inseridos', plan.inserts.length],
    ['Atualizados', plan.updates.length],
    ['Mantidos', plan.kept.length],
    ['Duplicados', plan.duplicates.reduce((total, duplicate) => total + duplicate.rowIds.length, 0)],
    ['Rejeitados', plan.rejected.length + validationRejected],
  ] as const;

  return (
    <dl className="export-summary">
      {counts.map(([label, count]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{count}</dd>
        </div>
      ))}
    </dl>
  );
}
