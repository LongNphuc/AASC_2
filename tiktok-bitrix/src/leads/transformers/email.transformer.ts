import { isEmail } from 'class-validator';

/** Bỏ khoảng trắng, viết thường: " NguyenVanA@Email.com " → "nguyenvana@email.com". */
export function normalizeEmail(text: string): string {
  return text.trim().toLowerCase();
}

/** Email đã chuẩn hóa, hoặc null nếu sai định dạng. */
export function toValidEmail(text: string | null | undefined): string | null {
  if (!text) return null;
  const email = normalizeEmail(text);
  return isEmail(email) ? email : null;
}
