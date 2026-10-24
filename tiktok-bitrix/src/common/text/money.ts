import { foldText } from './sanitize';

export interface MoneyRange {
  min: number;
  max: number;
  /** Giá trị giữa khoảng; một số thì bằng chính số đó. */
  mid: number;
}

/** Đơn vị đứng sau số (đã bỏ dấu, viết thường). */
const UNITS: ReadonlyArray<[pattern: RegExp, multiplier: number]> = [
  [/^(ty|billion|bn)\b/, 1e9],
  [/^(trieu|tr|million|m)\b/, 1e6],
  [/^(nghin|ngan|k|thousand)\b/, 1e3],
];

/**
 * Đọc số tiền trong câu trả lời (readme_design.md mục 4.5): lấy các số, nhân
 * theo đơn vị (triệu, tr, million = 10⁶; tỷ = 10⁹), khoảng thì lấy giá trị
 * giữa. Số không có đơn vị dùng đơn vị của số đứng sau ("5-10 triệu" là 5
 * triệu tới 10 triệu). Không có số thì null.
 *
 *   "5-10 triệu VND" → { min: 5e6, max: 1e7, mid: 7.5e6 }
 *   "2 tỷ"          → { min: 2e9, max: 2e9, mid: 2e9 }
 */
export function parseMoneyRange(text: string): MoneyRange | null {
  const folded = foldText(text);
  const pattern = /(\d+(?:[.,]\d+)?)\s*([a-z]*)/g;
  const numbers: { value: number; unit: number | null }[] = [];
  for (const match of folded.matchAll(pattern)) {
    const value = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(value)) continue;
    const unit = UNITS.find(([re]) => re.test(match[2]))?.[1] ?? null;
    numbers.push({ value, unit });
  }
  if (numbers.length === 0) return null;
  // Số không có đơn vị lấy đơn vị gần nhất đứng sau nó, rồi đứng trước nó.
  const resolved = numbers.map((n, i) => {
    const unit =
      n.unit ??
      numbers.slice(i + 1).find((m) => m.unit !== null)?.unit ??
      numbers
        .slice(0, i)
        .reverse()
        .find((m) => m.unit !== null)?.unit ??
      1;
    return n.value * unit;
  });
  const values = resolved.slice(0, 2);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, mid: (min + max) / 2 };
}
