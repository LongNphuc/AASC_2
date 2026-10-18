import { createHash } from 'node:crypto';

/** JSON với khóa sắp theo thứ tự chữ cái (ở mọi tầng), để cùng nội dung thì cùng chuỗi. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha16(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Sync hash: băm đúng dữ liệu sẽ gửi lên Bitrix24 (sau khi chuẩn hóa và áp
 * mapping). Hash đổi khi và chỉ khi dữ liệu gửi đi khác lần trước.
 */
export function syncHash(payload: Record<string, unknown>): string {
  return sha16(stableStringify(payload));
}

/** Dấu vân tay nội dung một hàng lúc đọc, để tìm lại hàng khi ghi kết quả. */
export function contentFingerprint(texts: string[]): string {
  return sha16(JSON.stringify(texts));
}
