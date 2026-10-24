import { createHash } from 'node:crypto';

/** JSON với khóa object đã sắp xếp, để cùng dữ liệu luôn ra cùng chuỗi. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * SHA-256 của bộ field sau khi áp mapping (readme_improvements.md mục 6): hash
 * bằng lần đẩy thành công trước thì không gọi Bitrix24.
 */
export function hashFields(fields: unknown): string {
  return createHash('sha256').update(stableStringify(fields)).digest('hex');
}
