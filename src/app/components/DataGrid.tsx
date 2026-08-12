import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CellValue, Dataset } from '../../domain/dataset/types';
import type { TransformCommand } from '../../domain/transforms/types';
import type { ValidationIssue } from '../../domain/validation/types';

interface FocusTarget {
  rowId: string;
  columnId: string;
}

interface DataGridProps {
  dataset: Dataset;
  issues?: readonly ValidationIssue[];
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
  focusTarget = null,
  busy = false,
  onEdit,
}: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const issueByCell = useMemo(() => new Map(
    issues.map((issue) => [`${issue.rowId}\u0000${issue.columnId}`, issue]),
  ), [issues]);
  const issueRows = useMemo(() => new Set(issues.map(({ rowId }) => rowId)), [issues]);
  const visibleRowIndices = useMemo(() => {
    if (!errorsOnly) return null;
    const indices: number[] = [];
    dataset.rows.forEach((row, index) => {
      if (issueRows.has(row.rowId)) indices.push(index);
    });
    return indices;
  }, [dataset.rows, errorsOnly, issueRows]);
  const visibleCount = visibleRowIndices?.length ?? dataset.rows.length;
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
        <label>
          <input
            type="checkbox"
            checked={errorsOnly}
            disabled={busy}
            onChange={(event) => setErrorsOnly(event.currentTarget.checked)}
          />
          Mostrar somente erros
        </label>
        <span>{visibleCount} de {dataset.rows.length} linhas</span>
      </div>
      <div ref={headerRef} className="data-grid-header" role="row" style={{ gridTemplateColumns, minWidth: gridWidth }}>
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
                  const cellIssue = issueByCell.get(`${row.rowId}\u0000${column.id}`);
                  const current = row.values[column.id] ?? null;
                  return (
                    <div role="gridcell" key={column.id} data-invalid={cellIssue ? true : undefined}>
                      <input
                        data-cell={`${row.rowId}:${column.id}`}
                        aria-label={`${column.header}, linha ${row.sourceRowNumber}`}
                        aria-invalid={cellIssue ? true : undefined}
                        title={cellIssue?.message}
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
      </div>
    </section>
  );
}
