import { formatTimestamp, nextRunAt } from './schedule';

describe('schedule', () => {
  it('lần kế tiếp = lúc lần trước xong + chu kỳ', () => {
    expect(nextRunAt(new Date('2026-10-18T02:45:08Z'), 900).toISOString()).toBe(
      '2026-10-18T03:00:08.000Z',
    );
    expect(
      nextRunAt(new Date('2026-10-18T02:32:54Z'), 1800).toISOString(),
    ).toBe('2026-10-18T03:02:54.000Z');
    expect(
      nextRunAt(new Date('2026-10-15T09:00:00Z'), 86400).toISOString(),
    ).toBe('2026-10-16T09:00:00.000Z');
  });

  it('chưa có finished_at thì tới hạn ngay', () => {
    const now = new Date('2026-10-15T03:00:00Z');
    expect(nextRunAt(null, 900, now)).toBe(now);
  });

  it('định dạng thời gian theo múi giờ', () => {
    expect(
      formatTimestamp(new Date('2026-10-15T03:00:00Z'), 'Asia/Ho_Chi_Minh'),
    ).toBe('2026-10-15 10:00:00');
  });
});
