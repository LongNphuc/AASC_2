import { foldText } from './sanitize';

/** Từ khóa nghĩa là mua ngay (0 tháng). */
const IMMEDIATE = ['ngay', 'cang som cang tot', 'asap', 'immediately'];

/** Đơn vị đứng sau số → số tháng của một đơn vị. */
const UNITS: ReadonlyArray<[pattern: RegExp, months: number]> = [
  [/^(ngay|days?)\b/, 1 / 30],
  [/^(tuan|weeks?)\b/, 1 / 4],
  [/^(thang|months?)\b/, 1],
  [/^(nam|years?)\b/, 12],
];

/**
 * Đọc thời gian dự định mua, ra số tháng (readme_design.md mục 4.5):
 * - "ngay", "càng sớm càng tốt", "asap", "immediately" → 0;
 * - số và đơn vị đứng sau (ngày ÷ 30, tuần ÷ 4, tháng × 1, năm × 12), khoảng
 *   thì lấy giá trị giữa;
 * - có số mà không có đơn vị, hoặc không có số lẫn từ khóa: null.
 *
 *   "Trong 1 tháng" → 1 · "2-3 tháng" → 2.5 · "6 months" → 6 · "1 tuần" → 0.25
 */
export function parseMonths(text: string): number | null {
  const folded = foldText(text);
  const pattern = /(\d+(?:[.,]\d+)?)\s*([a-z]*)/g;
  const numbers: { value: number; months: number | null }[] = [];
  for (const match of folded.matchAll(pattern)) {
    const value = Number(match[1].replace(',', '.'));
    const months = UNITS.find(([re]) => re.test(match[2]))?.[1] ?? null;
    numbers.push({ value, months });
  }
  if (numbers.length === 0) {
    return IMMEDIATE.some((word) => folded.includes(word)) ? 0 : null;
  }
  const resolved = numbers.map((n, i) => {
    const months =
      n.months ?? numbers.slice(i + 1).find((m) => m.months !== null)?.months;
    return months === undefined || months === null ? null : n.value * months;
  });
  const values = resolved.slice(0, 2).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
