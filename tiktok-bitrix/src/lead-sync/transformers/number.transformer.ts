/**
 * Đọc số: số thì lấy luôn; chuỗi thì bỏ ký tự tiền tệ, khoảng trắng và đoán
 * dấu phân cách theo kiểu Việt Nam (chép từ gg-sheets-bitrix, đầu vào là giá
 * trị payload thay cho ô Sheet): "50.000.000 đ" → 50000000, "1,5" → 1.5.
 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let text = value.replace(/[^\d.,-]/g, '');
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
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
