import React, { useEffect, useMemo, useState } from 'react';
import type { CellValue, Dataset } from '../../domain/dataset/types';
import { displayCellValue, getDistinctColumnValues, parseCellValueInput } from '../../domain/transforms/transform-values';

interface ValuePickerProps {
  dataset: Dataset;
  columnId: string;
  label: string;
  value: CellValue;
  disabled?: boolean;
  onChange(value: CellValue): void;
}

function optionValue(value: CellValue): string {
  return value === null || value === '' ? '__empty__' : `${typeof value}:${String(value)}`;
}

export function ValuePicker({ dataset, columnId, label, value, disabled = false, onChange }: ValuePickerProps) {
  const column = dataset.columns.find((candidate) => candidate.id === columnId);
  const suggestions = useMemo(() => column ? getDistinctColumnValues(dataset, columnId) : [], [column, columnId, dataset]);
  const [draft, setDraft] = useState(displayCellValue(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(displayCellValue(value));
    setError(null);
  }, [value]);

  const updateDraft = (next: string) => {
    setDraft(next);
    try {
      if (!column) return;
      const parsed = parseCellValueInput(next, column);
      setError(null);
      onChange(parsed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="value-picker">
      <label className="field">{label}
        <input
          value={draft}
          disabled={disabled || !column}
          onChange={(event) => updateDraft(event.currentTarget.value)}
          aria-invalid={error ? 'true' : undefined}
        />
      </label>
      <label className="field">Sugestões para {label}
        <select
          aria-label={`Sugestões para ${label}`}
          value=""
          disabled={disabled || !column}
          onChange={(event) => {
            const selected = suggestions.find((suggestion) => optionValue(suggestion) === event.currentTarget.value);
            if (selected === undefined && event.currentTarget.value !== '__empty__') return;
            const next = event.currentTarget.value === '__empty__' ? null : selected ?? null;
            setDraft(displayCellValue(next));
            setError(null);
            onChange(next);
          }}
        >
          <option value="">Selecionar valor</option>
          {suggestions.map((suggestion) => <option value={optionValue(suggestion)} key={optionValue(suggestion)}>{displayCellValue(suggestion)}</option>)}
        </select>
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {suggestions.length === 0 ? <p className="form-help">Nenhum valor encontrado; digite um valor livre.</p> : null}
    </div>
  );
}
