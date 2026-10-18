/**
 * Lần chạy kế tiếp của một batch: lúc lần trước kết thúc + `intervalSeconds`.
 * Ví dụ 900 giây, xong 09:45:08 → 10:00:08. Lần chạy chậm thì lần sau lùi
 * theo, không bao giờ chạy chồng hay chạy dồn.
 * Không có finished_at thì coi như tới hạn ngay (dòng batch mới tạo luôn có
 * finished_at, xem SyncBatchRepository.ensure).
 */
export function nextRunAt(
  finishedAt: Date | null,
  intervalSeconds: number,
  now = new Date(),
): Date {
  if (!finishedAt) return now;
  return new Date(finishedAt.getTime() + intervalSeconds * 1000);
}

/** Thời điểm theo múi giờ cho cột "Thời gian đồng bộ cuối": "2026-10-15 10:00:00". */
export function formatTimestamp(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}
