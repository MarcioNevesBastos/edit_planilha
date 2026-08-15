import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CellValue, Dataset } from '../../domain/dataset/types';
import type { TransformCommand } from '../../domain/transforms/types';
import type { ValidationIssue } from '../../domain/validation/types';
import { getExportRowCounts, getValidationErrorRowIds } from '../export-row-status';

export type DataGridView = 'all' | 'errors' | 'valid';

export interface DataGridFilters {
  view: DataGridView;
  issueRule: string;
  issueSeverity: 'all' | 'error' | 'warning';
}

const DEFAULT_FILTERS: DataGridFilters = {
  view: 'all',
  issueRule: 'all',
  issueSeverity: 'all',
};

interface FocusTarget {
  rowId: string;
  columnId: string;
}

interface DataGridProps {
  dataset: Dataset;
  issues?: readonly ValidationIssue[];
  filters?: DataGridFilters;
  onFiltersChange?(filters: DataGridFilters): void;
  focusTarget?: FocusTarget | null;
  busy?: boolean;
  onEdit(command: Extract<TransformCommand, { type: 'editCell' }>): void;
}

function displayValue(value: CellValue): string {
  return value === null ? '' : String(value);
}

function editedValue(value: string, original: CellValue): CellValue {
  if (typeof original === 'number') {
    const number = Number(value.replace(',', '.'));
    return value.trim() !== '' && Number.isFinite(number) ? number : value;
  }
  if (typeof original === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

export function DataGrid({
  dataset,
  issues = [],
  filters,
  onFiltersChange,
  focusTarget = null,
  busy = false,
  onEdit,
}: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [uncontrolledFilters, setUncontrolledFilters] = useState<DataGridFilters>(DEFAULT_FILTERS);
  const activeFilters = filters ?? uncontrolledFilters;
  const updateFilters = (update: Partial<DataGridFilters>) => {
    const next = { ...activeFilters, ...update };
    if (onFiltersChange) onFiltersChange(next);
    if (!filters) setUncontrolledFilters(next);
  };
  const filteredIssues = useMemo(() => issues.filter((issue) =>
    (activeFilters.issueRule === 'all' || (issue.ruleId ?? 'sem-regra') === activeFilters.issueRule)
    && (activeFilters.issueSeverity === 'all' || (issue.severity ?? 'error') === activeFilters.issueSeverity),
  ), [activeFilters.issueRule, activeFilters.issueSeverity, issues]);
  const issueByCell = useMemo(() => {
    const grouped = new Map<string, ValidationIssue[]>();
    filteredIssues.forEach((issue) => {
      const key = `${issue.rowId}\u0000${issue.columnId}`;
      grouped.set(key, [...(grouped.get(key) ?? []), issue]);
    });
    return grouped;
  }, [filteredIssues]);
  const issueRows = useMemo(() => new Set(filteredIssues.map(({ rowId }) => rowId)), [filteredIssues]);
  const ruleOptions = useMemo(() => [...new Set(issues.map(({ ruleId }) => ruleId ?? 'sem-regra'))], [issues]);
  const errorRowIds = useMemo(() => getValidationErrorRowIds(issues), [issues]);
  const rowCounts = useMemo(() => getExportRowCounts(dataset, issues), [dataset, issues]);
  const hasIssueFilters = activeFilters.issueRule !== 'all' || activeFilters.issueSeverity !== 'all';
  const visibleRowIndices = useMemo(() => {
    if (activeFilters.view === 'all' && !hasIssueFilters) return null;
    const indices: number[] = [];
    dataset.rows.forEach((row, index) => {
      const inView = activeFilters.view === 'all'
        || (activeFilters.view === 'errors' ? errorRowIds.has(row.rowId) : !errorRowIds.has(row.rowId));
      const matchesIssueFilters = !hasIssueFilters || issueRows.has(row.rowId);
      if (inView && matchesIssueFilters) indices.push(index);
    });
    return indices;
  }, [activeFilters.view, dataset.rows, errorRowIds, hasIssueFilters, issueRows]);
  const visibleCount = visibleRowIndices?.length ?? dataset.rows.length;
  const tabs = [
    ['all', 'Todas', rowCounts.totalRows],
    ['errors', 'Com erro', rowCounts.validationErrorRows],
    ['valid', 'Válidas', rowCounts.exportableRows],
  ] as const;
  const virtualizer = useVirtualizer({
    count: visibleCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 42,
    overscan: 6,
    initialRect: { width: 900, height: 360 },
    observeElementRect: (instance, callback) => {
      const element = instance.scrollElement;
      if (!element) return undefined;
      const report = () => {
        const rect = element.getBoundingClientRect();
        callback({ width: rect.width || 900, height: rect.height || 360 });
      };
      report();
      if (typeof ResizeObserver === 'undefined') return undefined;
      const observer = new ResizeObserver(report);
      observer.observe(element);
      return () => observer.disconnect();
    },
  });

  useEffect(() => {
    if (!focusTarget) return;
    const sourceIndex = dataset.rows.findIndex(({ rowId }) => rowId === focusTarget.rowId);
    const visibleIndex = visibleRowIndices
      ? visibleRowIndices.indexOf(sourceIndex)
      : sourceIndex;
    if (visibleIndex < 0) return;
    virtualizer.scrollToIndex(visibleIndex, { align: 'center' });
    requestAnimationFrame(() => {
      const selector = `[data-cell="${CSS.escape(`${focusTarget.rowId}:${focusTarget.columnId}`)}"]`;
      scrollRef.current?.querySelector<HTMLInputElement>(selector)?.focus();
    });
  }, [dataset.rows, focusTarget, visibleRowIndices, virtualizer]);

  useEffect(() => {
    const viewport = scrollRef.current;
    const header = headerRef.current;
    if (!viewport || !header) return undefined;

    const syncHorizontalScroll = () => {
      header.style.transform = `translateX(-${viewport.scrollLeft}px)`;
    };

    syncHorizontalScroll();
    viewport.addEventListener('scroll', syncHorizontalScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', syncHorizontalScroll);
  }, []);

  const virtualRows = virtualizer.getVirtualItems();
  const gridTemplateColumns = `72px repeat(${dataset.columns.length}, minmax(160px, 1fr))`;
  const gridWidth = 72 + dataset.columns.length * 160;

  return (
    <section className="data-grid-shell" aria-label="Prévia dos dados">
      <div className="grid-toolbar">
        <div className="grid-view-tabs" role="tablist" aria-label="Filtrar linhas por status">
          {tabs.map(([view, label, count]) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeFilters.view === view}
              aria-controls="preview-grid"
              disabled={busy}
              key={view}
              onClick={() => updateFilters({ view })}
            >
              {label} <span>{count}</span>
            </button>
          ))}
        </div>
        <div className="grid-row-counts" aria-label="Contagem de linhas">
          <span><strong>{rowCounts.validationErrorRows}</strong> {rowCounts.validationErrorRows === 1 ? 'linha' : 'linhas'} com erro</span>
          <span><strong>{rowCounts.exportableRows}</strong> {rowCounts.exportableRows === 1 ? 'linha' : 'linhas'} válida{rowCounts.exportableRows === 1 ? '' : 's'}</span>
          <span><strong>{rowCounts.totalRows}</strong> total</span>
        </div>
        <label>Filtrar regra
          <select aria-label="Filtrar regra" value={activeFilters.issueRule} disabled={busy} onChange={(event) => updateFilters({ issueRule: event.currentTarget.value })}>
            <option value="all">Todas</option>
            {ruleOptions.map((ruleId) => <option value={ruleId} key={ruleId}>{ruleId}</option>)}
          </select>
        </label>
        <label>Filtrar severidade
          <select aria-label="Filtrar severidade" value={activeFilters.issueSeverity} disabled={busy} onChange={(event) => updateFilters({ issueSeverity: event.currentTarget.value as DataGridFilters['issueSeverity'] })}>
            <option value="all">Todas</option>
            <option value="error">Erros</option>
            <option value="warning">Avisos</option>
          </select>
        </label>
        <span>{visibleCount} de {dataset.rows.length} linhas</span>
      </div>
      <div id="preview-grid" ref={headerRef} className="data-grid-header" role="row" style={{ gridTemplateColumns, minWidth: gridWidth }}>
        <div role="columnheader">Linha</div>
        {dataset.columns.map((column) => (
          <div
            className="data-grid-header-cell"
            role="columnheader"
            key={column.id}
            title={column.header}
          >
            {column.header}
          </div>
        ))}
      </div>
      <div ref={scrollRef} className="data-grid-viewport">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: gridWidth }}>
          {virtualRows.map((virtualRow) => {
            const sourceIndex = visibleRowIndices?.[virtualRow.index] ?? virtualRow.index;
            const row = dataset.rows[sourceIndex];
            return (
              <div
                role="row"
                key={row.rowId}
                className="data-grid-row"
                style={{
                  gridTemplateColumns,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div role="rowheader">{row.sourceRowNumber}</div>
                {dataset.columns.map((column) => {
                  const cellIssues = issueByCell.get(`${row.rowId}\u0000${column.id}`) ?? [];
                  const cellIssue = cellIssues[0];
                  const current = row.values[column.id] ?? null;
                  return (
                    <div role="gridcell" key={column.id} data-invalid={cellIssue ? true : undefined}>
                      <input
                        data-cell={`${row.rowId}:${column.id}`}
                        aria-label={`${column.header}, linha ${row.sourceRowNumber}`}
                        aria-invalid={cellIssue ? true : undefined}
                        title={cellIssues.map(({ message }) => message).join(' | ')}
                        defaultValue={displayValue(current)}
                        disabled={busy}
                        onBlur={(event) => {
                          const value = editedValue(event.currentTarget.value, current);
                          if (!Object.is(value, current)) {
                            onEdit({ type: 'editCell', rowId: row.rowId, columnId: column.id, value });
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {visibleCount === 0 ? <p className="grid-empty">Nenhuma linha corresponde aos filtros selecionados.</p> : null}
      </div>
    </section>
  );
}
