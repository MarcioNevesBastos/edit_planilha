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
      tokens.push(...tokenizeFormulaSegment(formula.slice(cursor)));
      break;
    }
    if (quote > cursor) {
      tokens.push(...tokenizeFormulaSegment(formula.slice(cursor, quote)));
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

function tokenizeFormulaSegment(segment: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  const structuredReferenceStart = /(?:[A-Za-z_\\][A-Za-z0-9_.]*)?\[/g;
  let cursor = 0;

  let match: RegExpExecArray | null;
  while ((match = structuredReferenceStart.exec(segment)) !== null) {
    const start = match.index ?? 0;
    const openingBracket = start + match[0].length - 1;
    const closingBracket = findClosingBracket(segment, openingBracket);
    if (closingBracket < 0) {
      break;
    }
    if (start > cursor) {
      tokens.push({ literal: false, value: segment.slice(cursor, start) });
    }
    tokens.push({ literal: true, value: segment.slice(start, closingBracket + 1) });
    cursor = closingBracket + 1;
    structuredReferenceStart.lastIndex = cursor;
  }

  if (cursor < segment.length) {
    tokens.push({ literal: false, value: segment.slice(cursor) });
  }
  return tokens;
}

function findClosingBracket(value: string, openingBracket: number): number {
  let depth = 0;
  for (let index = openingBracket; index < value.length; index += 1) {
    if (value[index] === '[') {
      depth += 1;
    } else if (value[index] === ']') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
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
