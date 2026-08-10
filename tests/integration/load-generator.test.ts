import { describe, expect, it } from 'vitest';
import {
  LOAD_ROW_COUNTS,
  generateLoadCsv,
} from '../support/load-generator';

describe('deterministic load generator', () => {
  it('defines the progressive 10k, 50k, and 100k release datasets', () => {
    expect(LOAD_ROW_COUNTS).toEqual([10_000, 50_000, 100_000]);
  });

  it('reproduces mixed semantic values without binary fixtures', () => {
    const first = generateLoadCsv(10_000);
    const second = generateLoadCsv(10_000);
    const lines = first.split('\n');

    expect(second).toBe(first);
    expect(lines).toHaveLength(10_002);
    expect(lines[0]).toBe('ID;Produto;Quantidade;Preço;Ativo;Data;Observação');
    expect(lines[1]).toBe('1;Produto 000001;2;1,37;true;2026-01-02;Lote 1');
    expect(lines[10_000]).toBe('10000;Produto 010000;194;13700,00;false;2026-04-05;Lote 4');
    expect(lines.at(-1)).toBe('');
  });

  it('rejects invalid row counts before allocating output', () => {
    expect(() => generateLoadCsv(0)).toThrow('rowCount must be a positive whole number');
    expect(() => generateLoadCsv(1.5)).toThrow('rowCount must be a positive whole number');
  });
});
