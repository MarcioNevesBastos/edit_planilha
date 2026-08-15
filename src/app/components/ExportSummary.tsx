import React from 'react';
import type { Dataset } from '../../domain/dataset/types';
import type { WritePlan } from '../../domain/merge/types';
import type { ValidationIssue } from '../../domain/validation/types';
import { getExportRowCounts, getValidationErrorRowIds } from '../export-row-status';

interface ExportSummaryProps {
  dataset: Dataset;
  plan: WritePlan;
  validationIssues: readonly ValidationIssue[];
}

export interface ExportLineCountsProps {
  dataset: Dataset;
  plan?: WritePlan;
  validationIssues: readonly ValidationIssue[];
}

export function ExportLineCounts({ dataset, plan, validationIssues }: ExportLineCountsProps) {
  const counts = getExportRowCounts(dataset, validationIssues, plan);

  return (
    <dl className="export-line-counts" aria-label="Contagem de linhas para exportação">
      <div>
        <dt>Linhas válidas</dt>
        <dd>{counts.exportableRows}</dd>
        <small>serão exportadas</small>
      </div>
      <div>
        <dt>Linhas com erro/rejeitadas</dt>
        <dd>{counts.rejectedRows}</dd>
        <small>não serão gravadas no destino</small>
      </div>
      <div>
        <dt>Total analisado</dt>
        <dd>{counts.totalRows}</dd>
        <small>linhas de origem</small>
      </div>
    </dl>
  );
}

export function ExportSummary({ dataset, plan, validationIssues }: ExportSummaryProps) {
  const invalidRowIds = getValidationErrorRowIds(validationIssues);
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
    <>
      <ExportLineCounts dataset={dataset} plan={plan} validationIssues={validationIssues} />
      <dl className="export-summary">
        {counts.map(([label, count]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
