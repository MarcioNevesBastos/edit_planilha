export const LOAD_ROW_COUNTS = [10_000, 50_000, 100_000] as const;

const HEADER = 'ID;Produto;Quantidade;Preço;Ativo;Data;Observação';

export function generateLoadCsv(rowCount: number): string {
  if (!Number.isSafeInteger(rowCount) || rowCount < 1) {
    throw new RangeError('rowCount must be a positive whole number');
  }

  const lines = new Array<string>(rowCount + 1);
  lines[0] = HEADER;

  for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
    const quantity = ((rowNumber * 8 + 193) % 200) + 1;
    const price = (rowNumber * 1.37).toFixed(2).replace('.', ',');
    const month = String(((rowNumber - 1) % 12) + 1).padStart(2, '0');
    const day = String((rowNumber % 28) + 1).padStart(2, '0');
    const note = rowNumber % 11 === 0 ? '' : `Lote ${rowNumber % 7}`;

    lines[rowNumber] = [
      rowNumber,
      `Produto ${String(rowNumber).padStart(6, '0')}`,
      quantity,
      price,
      rowNumber % 2 === 1,
      `2026-${month}-${day}`,
      note,
    ].join(';');
  }

  return `${lines.join('\n')}\n`;
}
