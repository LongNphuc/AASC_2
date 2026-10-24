/**
 * Làm sạch chuỗi người dùng nhập (readme_design.md mục 4.2): bỏ thẻ HTML và ký
 * tự điều khiển, gộp khoảng trắng, chuẩn Unicode NFC. Trả null nếu không còn gì.
 */
export function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value)
    .normalize('NFC')
    .replace(/<[^>]*>/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/** Bỏ dấu tiếng Việt, viết thường: "Ngân Sách" → "ngan sach". */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
