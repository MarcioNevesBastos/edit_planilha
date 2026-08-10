import React from 'react';
import type { WritePlan } from '../../domain/merge/types';
import type { ValidationIssue } from '../../domain/validation/types';

interface ExportSummaryProps {
  plan: WritePlan;
  validationIssues: readonly ValidationIssue[];
}

export function ExportSummary({ plan, validationIssues }: ExportSummaryProps) {
  const invalidRowIds = new Set(validationIssues.map(({ rowId }) => rowId));
  const planRejectedRowIds = new Set(plan.rejected.map(({ incomingRowId }) => incomingRowId));
  const isEffective = (rowId: string) => !invalidRowIds.has(rowId) && !planRejectedRowIds.has(rowId);
  const duplicateRowIds = new Set(plan.duplicates.flatMap(({ rowIds }) => rowIds));
  const rejectedRowIds = new Set([...invalidRowIds, ...planRejectedRowIds]);
  const counts = [
    ['Inseridos', plan.inserts.filter(({ incomingRowId }) => isEffective(incomingRowId)).length],
    ['Atualizados', plan.updates.filter(({ incomingRowId }) => isEffective(incomingRowId)).length],
    ['Mantidos', plan.kept.filter(({ incomingRowId }) => isEffective(incomingRowId)).length],
    ['Duplicados', duplicateRowIds.size],
    ['Rejeitados', rejectedRowIds.size],
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
