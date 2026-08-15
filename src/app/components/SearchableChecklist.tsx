import React, { useMemo, useState } from 'react';
import { normalizeText } from '../../utils/text-normalize';

export interface SearchableChecklistOption {
  id: string;
  label: string;
}

interface SearchableChecklistProps {
  title: string;
  options: readonly SearchableChecklistOption[];
  selectedIds: readonly string[];
  disabled?: boolean;
  onToggle(id: string): void;
}

function resultLabel(count: number): string {
  return `${count} resultado${count === 1 ? '' : 's'}`;
}

export function SearchableChecklist({
  title,
  options,
  selectedIds,
  disabled = false,
  onToggle,
}: SearchableChecklistProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = normalizeText(query);
  const visibleOptions = useMemo(
    () => options.filter((option) => normalizeText(option.label).includes(normalizedQuery)),
    [normalizedQuery, options],
  );
  const searchLabel = `Pesquisar ${title.toLocaleLowerCase('pt-BR')}`;

  return (
    <fieldset className="searchable-checklist">
      <legend>{title}</legend>
      <label className="searchable-list-search">
        <span>Pesquisar</span>
        <input
          type="search"
          value={query}
          disabled={disabled}
          aria-label={searchLabel}
          placeholder="Digite para filtrar"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div className="searchable-list-results" aria-live="polite">
        <span>{resultLabel(visibleOptions.length)}</span>
        <div className="searchable-checklist-viewport">
          {visibleOptions.length === 0 ? <p className="form-help">Nenhuma coluna encontrada.</p> : visibleOptions.map((option) => (
            <label key={option.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(option.id)}
                disabled={disabled}
                onChange={() => onToggle(option.id)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
