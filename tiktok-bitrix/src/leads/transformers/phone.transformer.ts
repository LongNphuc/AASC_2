import {
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

/**
 * Chuẩn hóa SĐT về E.164 (chuẩn quốc tế, cũng là dạng TikTok Events API cần
 * trước khi băm), hoặc null nếu không hợp lệ. Số không có mã quốc gia hiểu
 * theo vùng mặc định (PHONE_DEFAULT_REGION). Số Việt Nam có thể thiếu "+"
 * ("84901234567") hoặc thiếu số 0 đầu ("901234567").
 *
 *   "0901 234 567", "+84 90 123 4567", "84901234567" → "+84901234567"
 */
export function normalizePhone(
  raw: string | null | undefined,
  region = 'VN',
): string | null {
  if (!raw) return null;
  let text = raw.replace(/[\s.\-()]/g, '');
  if (!text) return null;
  if (region === 'VN' && /^84\d{9}$/.test(text)) text = `+${text}`;
  if (region === 'VN' && /^\d{9}$/.test(text)) text = `0${text}`;
  const phone = parsePhoneNumberFromString(text, region as CountryCode);
  return phone?.isValid() ? phone.number : null;
}
