const CELL_REFERENCE = /(?<![A-Za-z0-9_.])(?:(?:'(?:[^']|'')+'|[A-Za-z_\\][A-Za-z0-9_.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g;
const MAX_COLUMN = 16_384;
const MAX_ROW = 1_048_576;

export function shiftFormulaA1(
  formula: string,
  rowDelta: number,
  colDelta: number,
): string {
  return tokenizeFormula(formula)
    .map((token) => token.literal ? token.value : shiftReferences(token.value, rowDelta, colDelta))
    .join('');
}

interface FormulaToken {
  literal: boolean;
  value: string;
}

function tokenizeFormula(formula: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let cursor = 0;

  while (cursor < formula.length) {
    const quote = formula.indexOf('"', cursor);
    if (quote < 0) {
      tokens.push({ literal: false, value: formula.slice(cursor) });
      break;
    }
    if (quote > cursor) {
      tokens.push({ literal: false, value: formula.slice(cursor, quote) });
    }

    let end = quote + 1;
    while (end < formula.length) {
      if (formula[end] !== '"') {
        end += 1;
      } else if (formula[end + 1] === '"') {
        end += 2;
      } else {
        end += 1;
        break;
      }
    }
    tokens.push({ literal: true, value: formula.slice(quote, end) });
    cursor = end;
  }

  return tokens;
}

function shiftReferences(segment: string, rowDelta: number, colDelta: number): string {
  return segment.replace(
    CELL_REFERENCE,
    (reference, absoluteColumn: string, columnLetters: string, absoluteRow: string, rowText: string) => {
      const column = columnNumber(columnLetters);
      const row = Number(rowText);
      if (column > MAX_COLUMN || row > MAX_ROW) {
        return reference;
      }

      const shiftedColumn = absoluteColumn ? column : column + colDelta;
      const shiftedRow = absoluteRow ? row : row + rowDelta;
      if (
        shiftedColumn < 1
        || shiftedColumn > MAX_COLUMN
        || shiftedRow < 1
        || shiftedRow > MAX_ROW
      ) {
        return '#REF!';
      }

      const qualifierLength = reference.length
        - absoluteColumn.length
        - columnLetters.length
        - absoluteRow.length
        - rowText.length;
      const qualifier = reference.slice(0, qualifierLength);
      return `${qualifier}${absoluteColumn}${columnName(shiftedColumn)}${absoluteRow}${shiftedRow}`;
    },
  );
}

function columnNumber(letters: string): number {
  return [...letters.toUpperCase()].reduce(
    (column, letter) => column * 26 + letter.charCodeAt(0) - 64,
    0,
  );
}

function columnName(column: number): string {
  let value = column;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}
