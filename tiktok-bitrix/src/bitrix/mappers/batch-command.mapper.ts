import { BatchCommand } from '../types/bitrix.types';

/**
 * Dựng tham số dạng query string kiểu PHP (http_build_query) cho một lệnh
 * trong batch: { fields: { PHONE: [{ VALUE: '+84…' }] } } →
 * "fields[PHONE][0][VALUE]=%2B84…".
 */
export function toQueryString(params: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (prefix: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(`${prefix}[${index}]`, item));
    } else if (typeof value === 'object') {
      for (const [key, item] of Object.entries(
        value as Record<string, unknown>,
      )) {
        walk(`${prefix}[${key}]`, item);
      }
    } else {
      const scalar = typeof value === 'string' ? value : JSON.stringify(value);
      parts.push(`${prefix}=${encodeURIComponent(scalar)}`);
    }
  };
  for (const [key, value] of Object.entries(params)) {
    walk(key, value);
  }
  return parts.join('&');
}

export function toBatchCommand(command: BatchCommand): string {
  const query = toQueryString(command.params);
  return query ? `${command.method}?${query}` : command.method;
}
