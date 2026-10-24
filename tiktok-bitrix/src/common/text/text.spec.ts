import { parseMonths } from './duration';
import { parseMoneyRange } from './money';
import { cleanText, foldText } from './sanitize';
import { slugify } from './slugify';

describe('cleanText', () => {
  it('bỏ HTML, ký tự điều khiển, gộp khoảng trắng, NFC; rỗng thì null', () => {
    expect(cleanText(' <b>Nguyễn</b>   Văn\u0007A ')).toBe('Nguyễn Văn A');
    expect(cleanText('Nguyễn')).toBe('Nguyễn');
    expect(cleanText(123)).toBe('123');
    expect(cleanText('   ')).toBeNull();
    expect(cleanText({})).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });

  it('foldText bỏ dấu, viết thường; slugify ra khóa câu hỏi', () => {
    expect(foldText('Ngân Sách  Đầu Tư')).toBe('ngan sach dau tu');
    expect(slugify('Budget range')).toBe('budget_range');
    expect(slugify('Ngân sách?')).toBe('ngan_sach');
  });
});

describe('parseMoneyRange', () => {
  it.each([
    ['5-10 triệu VND', 7_500_000],
    ['2 tỷ', 2_000_000_000],
    ['500k', 500_000],
    ['Trên 20 triệu', 20_000_000],
    ['1,5 tr', 1_500_000],
    ['10 million', 10_000_000],
  ])('%s → %d', (text, mid) => {
    expect(parseMoneyRange(text)?.mid).toBe(mid);
  });

  it('không có số thì null; số không đơn vị lấy đơn vị đứng trước', () => {
    expect(parseMoneyRange('chưa biết')).toBeNull();
    expect(parseMoneyRange('5 triệu tới 8')).toEqual({
      min: 5e6,
      max: 8e6,
      mid: 6.5e6,
    });
    expect(parseMoneyRange('300')?.mid).toBe(300);
  });
});

describe('parseMonths', () => {
  it.each([
    ['Trong 1 tháng', 1],
    ['2-3 tháng', 2.5],
    ['6 months', 6],
    ['1 tuần', 0.25],
    ['1 năm', 12],
    ['Ngay lập tức', 0],
    ['ASAP', 0],
  ])('%s → %d', (text, months) => {
    expect(parseMonths(text)).toBe(months);
  });

  it('có số mà không có đơn vị, hoặc không đọc được: null', () => {
    expect(parseMonths('3')).toBeNull();
    expect(parseMonths('chưa biết')).toBeNull();
    expect(parseMonths('5 ngày')).toBeCloseTo(1 / 6);
  });
});
