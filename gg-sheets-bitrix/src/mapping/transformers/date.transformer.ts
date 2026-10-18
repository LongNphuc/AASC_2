import type { SheetCell } from '../../google/types/sheets.types';

/** Ngày 0 của Google Sheets là 30/12/1899; 25569 là số ngày tới 01/01/1970. */
const SHEETS_EPOCH_OFFSET_DAYS = 25569;
const DAY_MS = 86_400_000;

/**
 * Đọc ngày từ một ô, trả "YYYY-MM-DD" hoặc null:
 * - ô định dạng ngày: Sheets trả số ngày (46310 → 2026-10-15);
 * - ô chữ: "15/10/2026", "15-10-2026" hoặc "2026-10-15".
 */
export function parseDate(cell: SheetCell): string | null {
  if (
    typeof cell.value === 'number' &&
    /DATE/.test(cell.formatType ?? 'DATE')
  ) {
    const date = new Date(
      Math.round((cell.value - SHEETS_EPOCH_OFFSET_DAYS) * DAY_MS),
    );
    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString().slice(0, 10);
  }
  const text = cell.text.trim();
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (match) return toIso(+match[3], +match[2], +match[1]);
  match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) return toIso(+match[1], +match[2], +match[3]);
  return null;
}

function toIso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}
