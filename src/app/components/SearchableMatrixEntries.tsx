import React, { useMemo, useState } from 'react';
import { normalizeText } from '../../utils/text-normalize';

interface SearchableMatrixEntriesProps<T> {
  entries: readonly T[];
  getSearchText(entry: T): string;
  colSpan: number;
  disabled?: boolean;
  renderHeader(): React.ReactNode;
  renderEntry(entry: T, originalIndex: number): React.ReactNode;
}

export function SearchableMatrixEntries<T>({
  entries,
  getSearchText,
  colSpan,
  disabled = false,
  renderHeader,
  renderEntry,
}: SearchableMatrixEntriesProps<T>) {
  const [query, setQuery] = useState('');
  const normalizedQuery = normalizeText(query);
  const matchingEntries = useMemo(
    () => entries
      .map((entry, originalIndex) => ({ entry, originalIndex }))
      .filter(({ entry }) => normalizeText(getSearchText(entry)).includes(normalizedQuery)),
    [entries, getSearchText, normalizedQuery],
  );

  return (
    <section className="searchable-matrix-entries">
      <div className="matrix-entry-search">
        <label>
          <span>Pesquisar linhas</span>
          <input
            type="search"
            value={query}
            disabled={disabled}
            aria-label="Pesquisar linhas da matriz"
            placeholder="Digite um valor ou regra"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <span aria-live="polite">{matchingEntries.length} linha(s) encontrada(s)</span>
      </div>
      <div className="conditional-matrix-scroll">
        <table className="conditional-matrix-table">
          <thead>{renderHeader()}</thead>
          <tbody>
            {matchingEntries.length === 0 ? (
              <tr><td colSpan={colSpan}>{entries.length === 0 ? 'Nenhuma linha configurada.' : 'Nenhuma linha encontrada.'}</td></tr>
            ) : matchingEntries.map(({ entry, originalIndex }) => renderEntry(entry, originalIndex))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
