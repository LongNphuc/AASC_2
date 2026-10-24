import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * So sánh hai chuỗi bí mật trong thời gian không đổi, để không dò được khóa
 * qua thời gian phản hồi. Băm trước để hai chuỗi luôn cùng độ dài, đúng yêu
 * cầu của timingSafeEqual.
 */
export function safeEquals(a: string, b: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(a), hash(b));
}
