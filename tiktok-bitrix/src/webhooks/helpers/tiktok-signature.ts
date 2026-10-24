import { createHmac } from 'node:crypto';
import { safeEquals } from '../../common/auth/safe-equals';

/** Header chữ ký theo đề. Đổi tên header hoặc cách ghép chuỗi chỉ cần sửa tệp này. */
export const TIKTOK_SIGNATURE_HEADER = 'tiktok-signature';

export type SignatureCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'missing' | 'format' | 'expired' | 'mismatch';
      skew?: number;
    };

/**
 * Ký payload theo format của TikTok (readme_design.md mục 3.3):
 *   TikTok-Signature: t=<giây>,s=hex(HMAC_SHA256(secret, "<t>.<raw body>"))
 * Script mock và test dùng hàm này để gửi webhook hợp lệ.
 */
export function signTiktokPayload(
  rawBody: string | Buffer,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},s=${hmac(secret, timestamp, rawBody)}`;
}

/**
 * Kiểm chữ ký trên raw body, đúng từng byte TikTok gửi: băm lại từ object đã
 * parse sẽ ra chữ ký khác (khoảng trắng, thứ tự khóa). Hợp lệ khi
 * |now − t| ≤ tolerance và chữ ký khớp (so trong thời gian không đổi).
 */
export function verifyTiktokSignature(
  header: string | undefined,
  rawBody: Buffer,
  secret: string,
  toleranceSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): SignatureCheck {
  if (!header) return { ok: false, reason: 'missing' };
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const index = part.indexOf('=');
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !/^[0-9a-f]+$/i.test(parts.s ?? '')) {
    return { ok: false, reason: 'format' };
  }
  const skew = Math.abs(nowSeconds - timestamp);
  if (skew > toleranceSeconds) return { ok: false, reason: 'expired', skew };
  if (!safeEquals(hmac(secret, timestamp, rawBody), parts.s.toLowerCase())) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true };
}

function hmac(
  secret: string,
  timestamp: number,
  rawBody: string | Buffer,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
}
