/**
 * Đọc ngày, trả "YYYY-MM-DD" hoặc null (chép từ gg-sheets-bitrix): số giây
 * unix, "15/10/2026", "15-10-2026" hoặc "2026-10-15".
 */
export function parseDate(value: unknown): string | null {
  if (typeof value === 'number') {
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (match) return toIso(+match[3], +match[2], +match[1]);
  match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (match) return toIso(+match[1], +match[2], +match[3]);
  return null;
}

/** Thời điểm ISO 8601 cho field datetime: số giây unix hoặc chuỗi ngày giờ. */
export function parseDateTime(value: unknown): string | null {
  if (typeof value === 'number') {
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  const day = parseDate(value);
  return day ? `${day}T00:00:00.000Z` : null;
}

function toIso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}
