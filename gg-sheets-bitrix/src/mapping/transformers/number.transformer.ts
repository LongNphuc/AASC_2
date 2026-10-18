import type { SheetCell } from '../../google/types/sheets.types';

/**
 * Đọc số từ một ô: ô kiểu số thì lấy luôn giá trị; ô chữ thì bỏ ký tự tiền
 * tệ, khoảng trắng và đoán dấu phân cách theo kiểu Việt Nam:
 * "50.000.000 đ" → 50000000, "1,5" → 1.5, "1.234,5" → 1234.5.
 */
export function parseNumber(cell: SheetCell): number | null {
  if (typeof cell.value === 'number') return cell.value;
  let text = cell.text.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(text)) return null;
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let decimal: '.' | ',' | null = null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimal = lastDot > lastComma ? '.' : ',';
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const count = text.split(sep).length - 1;
    const groupsOfThree = new RegExp(`\\${sep}\\d{3}$`).test(text);
    decimal = count === 1 && !groupsOfThree ? sep : null;
  }
  const thousands = decimal === '.' ? ',' : '.';
  text = text.split(thousands).join('');
  if (decimal === ',') text = text.replace(',', '.');
  if (decimal === null) text = text.replace(/[.,]/g, '');
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
