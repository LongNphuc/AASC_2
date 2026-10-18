/** Thời gian hiển thị theo tiếng Việt; trống thì gạch ngang. */
export function formatTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('vi-VN') : '—';
}

/** Ai kích hoạt lần chạy. */
export function triggerLabel(trigger: string): string {
  return { SCHEDULE: 'Theo lịch', MANUAL: 'Chạy tay', STARTUP: 'Khi khởi động' }[trigger] ?? trigger;
}

/** Thời gian còn lại tới `iso`, dạng "12 phút" / "1 giờ 5 phút". */
export function timeUntil(iso: string): string {
  const minutes = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút` : `${minutes} phút`;
}

/** [40, 41, 42, 45] → "40–42, 45". */
export function compactRanges(numbers: number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return parts.join(', ');
}

/** JSON khóa đã sắp xếp, thụt lề 2: so sánh không phụ thuộc thứ tự khóa và khoảng trắng. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sort(value), null, 2);
}
