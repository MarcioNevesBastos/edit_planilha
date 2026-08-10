import React from 'react';
import type { CellValue, DatasetColumn } from '../../domain/dataset/types';
import type { MappingSuggestion } from '../../domain/mapping/types';

export type MappingAction = 'map' | 'ignore' | 'fixed';

export interface ReviewedMapping extends MappingSuggestion {
  action: MappingAction;
  fixedValue?: CellValue;
}

interface MappingGridProps {
  sourceColumns: readonly DatasetColumn[];
  destinationColumns: readonly DatasetColumn[];
  mappings: readonly ReviewedMapping[];
  disabled?: boolean;
  onChange(mappings: ReviewedMapping[]): void;
}

const confidenceLabels = {
  exact: 'Exata',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
} as const;

export function MappingGrid({
  sourceColumns,
  destinationColumns,
  mappings,
  disabled = false,
  onChange,
}: MappingGridProps) {
  const update = (sourceColumnId: string, patch: Partial<ReviewedMapping>) => {
    onChange(mappings.map((mapping) => mapping.sourceColumnId === sourceColumnId
      ? { ...mapping, ...patch }
      : mapping));
  };

  return (
    <div className="mapping-grid" role="table" aria-label="Revisão de mapeamentos">
      <div className="mapping-header" role="row">
        <span role="columnheader">Origem</span>
        <span role="columnheader">Destino sugerido</span>
        <span role="columnheader">Confiança</span>
        <span role="columnheader">Status e ação</span>
      </div>
      {mappings.map((mapping) => {
        const source = sourceColumns.find(({ id }) => id === mapping.sourceColumnId);
        if (!source) return null;
        return (
          <div className="mapping-row" role="row" key={mapping.sourceColumnId}>
            <strong role="cell">{source.header}</strong>
            <div role="cell">
              <label className="visually-hidden" htmlFor={`mapping-${source.id}`}>Destino para {source.header}</label>
              <select
                id={`mapping-${source.id}`}
                value={mapping.destinationColumnId ?? ''}
                disabled={disabled || mapping.action === 'ignore'}
                onChange={(event) => update(source.id, {
                  destinationColumnId: event.currentTarget.value || null,
                  action: 'map',
                  status: 'review-required',
                })}
              >
                <option value="">Sem sugestão</option>
                {destinationColumns.map((column) => (
                  <option value={column.id} key={column.id}>{column.header}</option>
                ))}
              </select>
              {mapping.action === 'fixed' ? (
                <input
                  aria-label={`Valor fixo para ${source.header}`}
                  value={String(mapping.fixedValue ?? '')}
                  disabled={disabled}
                  onChange={(event) => update(source.id, {
                    fixedValue: event.currentTarget.value,
                    status: event.currentTarget.value === '' ? 'review-required' : 'accepted',
                  })}
                />
              ) : null}
            </div>
            <span role="cell" className={`confidence confidence-${mapping.confidence}`}>
              {confidenceLabels[mapping.confidence]} · {Math.round(mapping.score * 100)}%
            </span>
            <div role="cell" className="mapping-actions">
              <span className={mapping.status === 'accepted' ? 'status-ok' : 'status-review'}>
                {mapping.status === 'accepted' ? 'Revisado' : 'Revisão necessária'}
              </span>
              <button
                type="button"
                disabled={disabled || mapping.destinationColumnId === null}
                onClick={() => update(source.id, { action: 'map', status: 'accepted', fixedValue: undefined })}
              >
                Aceitar {source.header}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => update(source.id, {
                  action: 'ignore',
                  destinationColumnId: null,
                  status: 'accepted',
                  fixedValue: undefined,
                })}
              >
                Ignorar {source.header}
              </button>
              <button
                type="button"
                disabled={disabled || mapping.destinationColumnId === null}
                onClick={() => update(source.id, { action: 'fixed', status: 'review-required', fixedValue: '' })}
              >
                Usar valor fixo {source.header}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
