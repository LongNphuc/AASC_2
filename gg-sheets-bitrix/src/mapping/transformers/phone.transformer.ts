import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { SheetCell } from '../../google/types/sheets.types';

/**
 * Chuẩn hóa số điện thoại Việt Nam về dạng E.164 (+84…), hoặc null nếu không
 * hợp lệ. Nhận cả số mà Google Sheets đã tự đổi thành kiểu số (mất số 0 đầu):
 * ô "0901234567" thành 901234567.
 */
export function normalizePhone(cell: SheetCell): string | null {
  let text =
    typeof cell.value === 'number'
      ? String(cell.value)
      : cell.text.replace(/[\s.\-()]/g, '');
  if (!text) return null;
  if (/^\d{9}$/.test(text)) {
    text = `0${text}`;
  }
  const phone = parsePhoneNumberFromString(text, 'VN');
  return phone?.isValid() ? phone.number : null;
}

/** Dạng trong nước của số E.164: "+84901234567" → "0901234567". */
export function toNationalPhone(e164: string): string {
  return e164.startsWith('+84') ? `0${e164.slice(3)}` : e164;
}
