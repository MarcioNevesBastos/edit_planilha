import type { Dataset } from '../domain/dataset/types';
import type { WritePlan } from '../domain/merge/types';
import type { ValidationIssue } from '../domain/validation/types';

export interface ExportRowCounts {
  totalRows: number;
  validationErrorRows: number;
  planRejectedRows: number;
  rejectedRows: number;
  exportableRows: number;
}

export function getValidationErrorRowIds(issues: readonly ValidationIssue[]): Set<string> {
  return new Set(issues
    .filter(({ severity }) => (severity ?? 'error') === 'error')
    .map(({ rowId }) => rowId));
}

export function getExportRowCounts(
  dataset: Dataset,
  issues: readonly ValidationIssue[],
  plan?: WritePlan,
): ExportRowCounts {
  const datasetRowIds = new Set(dataset.rows.map(({ rowId }) => rowId));
  const validationErrorIds = getValidationErrorRowIds(issues);
  const planRejectedIds = new Set(plan?.rejected.map(({ incomingRowId }) => incomingRowId) ?? []);
  const rejectedIds = new Set([...validationErrorIds, ...planRejectedIds]);
  const candidateIds = plan
    ? new Set([
      ...plan.assignments.map(({ incomingRowId }) => incomingRowId),
      ...plan.inserts.map(({ incomingRowId }) => incomingRowId),
      ...plan.updates.map(({ incomingRowId }) => incomingRowId),
      ...plan.kept.map(({ incomingRowId }) => incomingRowId),
    ])
    : datasetRowIds;
  const exportableIds = new Set([...candidateIds]
    .filter((rowId) => !rejectedIds.has(rowId)));

  return {
    totalRows: dataset.rows.length,
    validationErrorRows: validationErrorIds.size,
    planRejectedRows: planRejectedIds.size,
    rejectedRows: rejectedIds.size,
    exportableRows: exportableIds.size,
  };
}
