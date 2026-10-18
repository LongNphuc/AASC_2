import { cellRange, columnLetter, quoteSheetName } from './a1-notation';

describe('a1-notation', () => {
  it('đổi vị trí cột thành chữ cái', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual([
      'A',
      'Z',
      'AA',
      'AB',
      'ZZ',
      'AAA',
    ]);
  });

  it('tên tab có nháy đơn được nhân đôi', () => {
    expect(quoteSheetName("Khách's list")).toBe("'Khách''s list'");
  });

  it('dựng vùng một ô', () => {
    expect(cellRange('leads-template', 12, 27)).toBe("'leads-template'!AB12");
  });
});
