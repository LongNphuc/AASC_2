import { isEmail } from 'class-validator';

/** Bỏ khoảng trắng, viết thường: " A@ABC.vn " → "a@abc.vn". */
export function normalizeEmail(text: string): string {
  return text.trim().toLowerCase();
}

export function isValidEmail(text: string): boolean {
  return isEmail(normalizeEmail(text));
}
