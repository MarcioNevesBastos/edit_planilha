import { describe, expect, it } from 'vitest';
import { shiftFormulaA1 } from '../../../src/io/template/formula-shift';

describe('shiftFormulaA1', () => {
  it.each([
    ['=A1', 2, 3, '=D3'],
    ['=$A1', 2, 3, '=$A3'],
    ['=A$1', 2, 3, '=D$1'],
    ['=$A$1', 2, 3, '=$A$1'],
  ])('shifts only relative components in %s', (formula, rowDelta, colDelta, expected) => {
    expect(shiftFormulaA1(formula, rowDelta, colDelta)).toBe(expected);
  });

  it('shifts both endpoints of ranges and multiple references', () => {
    expect(shiftFormulaA1('=SUM(A1:B2)+C3+$D4+E$5+$F$6', 2, 1)).toBe(
      '=SUM(B3:C4)+D5+$D6+F$5+$F$6',
    );
  });

  it('preserves sheet qualifiers while shifting references', () => {
    expect(
      shiftFormulaA1("=Sheet1!A1+'Sales 2024'!$B2+'O''Brien'!C$3", 4, 2),
    ).toBe("=Sheet1!C5+'Sales 2024'!$B6+'O''Brien'!E$3");
  });

  it('preserves structured table references while shifting ordinary references', () => {
    expect(
      shiftFormulaA1('=Table1[A1]+B2+Table1[[#Data],[C3]]', 1, 1),
    ).toBe('=Table1[A1]+C3+Table1[[#Data],[C3]]');
  });

  it('does not alter A1-like text inside Excel string literals', () => {
    expect(
      shiftFormulaA1('=IF(A1="A1 and B2",B2,"He said ""C3""")', 1, 1),
    ).toBe('=IF(B2="A1 and B2",C3,"He said ""C3""")');
  });

  it('does not reinterpret function names or identifiers as cell references', () => {
    expect(shiftFormulaA1('=LOG10(A1)+RATE1+A1_RATE', 1, 1)).toBe(
      '=LOG10(B2)+RATE1+A1_RATE',
    );
  });

  it.each([
    ['=A1', -1, 0, '=#REF!'],
    ['=A1', 0, -1, '=#REF!'],
    ['=SUM(A1:B2)', -1, 0, '=SUM(#REF!:B1)'],
    ['=Sheet1!A1', -1, 0, '=#REF!'],
    ['=XFD1048576', 1, 1, '=#REF!'],
    ['=XFC1048575', 1, 1, '=XFD1048576'],
  ])('emits #REF! when shifting %s below worksheet bounds', (
    formula,
    rowDelta,
    colDelta,
    expected,
  ) => {
    expect(shiftFormulaA1(formula, rowDelta, colDelta)).toBe(expected);
  });
});
