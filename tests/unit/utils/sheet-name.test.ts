import { describe, expect, it } from 'vitest';
import { uniqueSheetName } from '../../../src/utils/sheet-name';

describe('uniqueSheetName', () => {
  it.each([
    [[], 'Registros rejeitados'],
    [['Registros rejeitados'], 'Registros rejeitados (2)'],
    [['Registros rejeitados', 'Registros rejeitados (2)'], 'Registros rejeitados (3)'],
  ])('increments the rejected-record sheet name around occupied names', (occupied, expected) => {
    expect(uniqueSheetName('Registros rejeitados', occupied)).toBe(expected);
  });

  it('treats occupied sheet names case-insensitively', () => {
    expect(uniqueSheetName('Registros rejeitados', ['REGISTROS REJEITADOS'])).toBe(
      'Registros rejeitados (2)',
    );
  });

  it('removes illegal Excel characters and boundary apostrophes', () => {
    expect(uniqueSheetName("'Erros:[2026]\\/?*'", [])).toBe('Erros  2026');
  });

  it('truncates the base so every numbered candidate stays within 31 characters', () => {
    const requested = 'Uma planilha rejeitada com nome muito longo';
    const first = uniqueSheetName(requested, []);
    const second = uniqueSheetName(requested, [first]);

    expect(first).toBe('Uma planilha rejeitada com nome');
    expect(second).toBe('Uma planilha rejeitada com (2)');
    expect([...first]).toHaveLength(31);
    expect([...second].length).toBeLessThanOrEqual(31);
  });

  it('uses a legal fallback when sanitization leaves no name', () => {
    expect(uniqueSheetName('[]:*?/\\', [])).toBe('Planilha');
  });
});
