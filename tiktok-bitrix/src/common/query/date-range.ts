export interface DateRange {
  /** Ngày đầu, ngày cuối (cả hai tính), dạng YYYY-MM-DD theo múi giờ ứng dụng. */
  fromDate: string;
  toDate: string;
  /** Thời điểm bắt đầu ngày đầu và bắt đầu ngày sau ngày cuối, để lọc `>= from AND < to`. */
  from: Date;
  to: Date;
  timezone: string;
}

const DAY_MS = 86_400_000;
const PRESETS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

/**
 * Khoảng thời gian của thống kê, export (readme_api.md mục 1):
 * `date_range=7d|30d|90d` (tính cả hôm nay), hoặc `from`, `to` (ngày, theo
 * APP_TIMEZONE). Không có gì thì mặc định 30 ngày.
 */
export function parseDateRange(
  input: { date_range?: string; from?: string; to?: string },
  timezone: string,
  now = new Date(),
): DateRange {
  const today = localDate(now, timezone);
  let fromDate: string;
  let toDate: string;
  if (input.from || input.to) {
    toDate = input.to ?? today;
    fromDate = input.from ?? addDays(toDate, -29);
  } else {
    const days = PRESETS[input.date_range ?? '30d'] ?? 30;
    toDate = today;
    fromDate = addDays(today, -(days - 1));
  }
  if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
  return {
    fromDate,
    toDate,
    from: zonedMidnight(fromDate, timezone),
    to: zonedMidnight(addDays(toDate, 1), timezone),
    timezone,
  };
}

/** Ngày (YYYY-MM-DD) của một thời điểm theo múi giờ. */
export function localDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
  return new Date(time).toISOString().slice(0, 10);
}

/** Thời điểm 00:00 của một ngày theo múi giờ (đổi ra UTC). */
export function zonedMidnight(date: string, timezone: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const offset = timezoneOffsetMs(new Date(guess), timezone);
  const result = guess - offset;
  // Ngày đổi giờ mùa hè: độ lệch ở kết quả có thể khác ở lần đoán đầu.
  const corrected = timezoneOffsetMs(new Date(result), timezone);
  return new Date(guess - corrected);
}

/** Giờ địa phương trừ giờ UTC tại một thời điểm, tính bằng ms. */
function timezoneOffsetMs(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/** "08/03/2024 12:42" theo múi giờ, dùng trong comment timeline. */
export function formatLocalDateTime(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}
