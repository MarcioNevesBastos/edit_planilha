import { describe, expect, it } from 'vitest';
import { suggestMappings } from '../../../src/domain/mapping/suggest-mappings';
import type { DatasetColumn } from '../../../src/domain/dataset/types';
import { normalizeText } from '../../../src/utils/text-normalize';

function column(id: string, header: string, sourceIndex: number): DatasetColumn {
  return { id, header, sourceIndex, detectedType: 'string' };
}

describe('normalizeText', () => {
  it('normalizes Unicode, diacritics, punctuation, whitespace, and common abbreviations', () => {
    expect(normalizeText('  Dt.  Nasc. – São-Paulo  ')).toBe('data nascimento sao paulo');
  });
});

describe('suggestMappings', () => {
  it('auto-accepts an exact normalized header match', () => {
    const suggestions = suggestMappings(
      [column('nome_do_cliente__1', ' Nome do Cliente ', 0)],
      [column('customer_name__1', 'nome-do-cliente', 0)],
    );

    expect(suggestions).toEqual([{
      sourceColumnId: 'nome_do_cliente__1',
      destinationColumnId: 'customer_name__1',
      confidence: 'exact',
      score: 1,
      status: 'accepted',
    }]);
  });

  it('suggests abbreviated fuzzy matches for human review', () => {
    const suggestions = suggestMappings(
      [column('data_nascimento__1', 'Dt. Nasc.', 0), column('endereco__1', 'End.', 1)],
      [column('birth_date__1', 'Data de Nascimento', 0), column('address__1', 'Endereço', 1)],
    );

    expect(suggestions.map(({ destinationColumnId, confidence, status }) => ({ destinationColumnId, confidence, status }))).toEqual([
      { destinationColumnId: 'birth_date__1', confidence: 'high', status: 'review-required' },
      { destinationColumnId: 'address__1', confidence: 'exact', status: 'accepted' },
    ]);
  });

  it('selects the highest scoring candidate deterministically and leaves it review-required', () => {
    const suggestions = suggestMappings(
      [column('customer_code__1', 'Código do Cliente', 0)],
      [
        column('customer_reference__1', 'Código de referência do cliente', 0),
        column('customer_code_target__1', 'Cod. Cliente', 1),
      ],
    );

    expect(suggestions).toMatchObject([{
      sourceColumnId: 'customer_code__1',
      destinationColumnId: 'customer_code_target__1',
      confidence: 'high',
      status: 'review-required',
    }]);
    expect(suggestions[0].score).toBeGreaterThanOrEqual(0.85);
    expect(suggestions[0].score).toBeLessThan(1);
  });

  it('returns a low-confidence review-required suggestion when no candidate matches', () => {
    const suggestions = suggestMappings(
      [column('customer__1', 'Cliente', 0)],
      [column('invoice__1', 'Número da fatura', 0)],
    );

    expect(suggestions).toEqual([{
      sourceColumnId: 'customer__1',
      destinationColumnId: null,
      confidence: 'low',
      score: 0,
      status: 'review-required',
    }]);
  });
});
