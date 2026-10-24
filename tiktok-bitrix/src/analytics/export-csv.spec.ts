import { csvCell } from './services/export.service';

describe('csvCell', () => {
  it('chuỗi bắt đầu bằng = + - @ (CSV injection): thêm dấu nháy đơn', () => {
    expect(csvCell('=HYPERLINK("http://x","bấm")')).toBe(
      `"'=HYPERLINK(""http://x"",""bấm"")"`,
    );
    expect(csvCell('+84901234567')).toBe("'+84901234567");
    expect(csvCell('-1+1')).toBe("'-1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\t=1')).toBe("'\t=1");
  });

  it('số, ngày, chuỗi thường giữ nguyên; có dấu phẩy, nháy, xuống dòng thì bọc nháy kép', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(new Date('2026-10-24T00:00:00Z'))).toBe(
      '2026-10-24T00:00:00.000Z',
    );
    expect(csvCell('Nguyễn Văn A')).toBe('Nguyễn Văn A');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(null)).toBe('');
  });
});
