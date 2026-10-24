import {
  addDays,
  formatLocalDateTime,
  localDate,
  parseDateRange,
  zonedMidnight,
} from './date-range';
import { paginate } from './pagination.dto';
import { SqlParams } from './sql-builder';

const TZ = 'Asia/Ho_Chi_Minh';

describe('date-range', () => {
  const now = new Date('2026-10-23T20:00:00Z'); // 24/10 giờ Việt Nam

  it('7d tính cả hôm nay theo múi giờ ứng dụng', () => {
    const range = parseDateRange({ date_range: '7d' }, TZ, now);
    expect(range).toMatchObject({
      fromDate: '2026-10-18',
      toDate: '2026-10-24',
      timezone: TZ,
    });
    expect(range.from.toISOString()).toBe('2026-10-17T17:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-24T17:00:00.000Z');
  });

  it('from/to; thiếu một đầu thì lấy 30 ngày; đảo ngược thì đổi chỗ; mặc định 30d', () => {
    expect(
      parseDateRange({ from: '2026-10-01', to: '2026-10-05' }, TZ, now).toDate,
    ).toBe('2026-10-05');
    expect(parseDateRange({ to: '2026-10-30' }, TZ, now).fromDate).toBe(
      '2026-10-01',
    );
    expect(
      parseDateRange({ from: '2026-10-10', to: '2026-10-01' }, TZ, now)
        .fromDate,
    ).toBe('2026-10-01');
    expect(parseDateRange({}, TZ, now).fromDate).toBe('2026-09-25');
    expect(parseDateRange({ from: '2026-10-20' }, TZ, now).toDate).toBe(
      '2026-10-24',
    );
  });

  it('đổi ngày, giờ theo múi giờ', () => {
    expect(localDate(now, TZ)).toBe('2026-10-24');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(zonedMidnight('2026-03-08', 'UTC').toISOString()).toBe(
      '2026-03-08T00:00:00.000Z',
    );
    expect(formatLocalDateTime(new Date(1709876543000), TZ)).toBe(
      '08/03/2024 12:42',
    );
  });
});

describe('SqlParams', () => {
  it('chỉ thêm điều kiện có giá trị, đánh số tham số theo thứ tự', () => {
    const p = new SqlParams();
    p.where('a', (x) => `x = ${x}`)
      .where(undefined, (x) => `y = ${x}`)
      .where('', (x) => `z = ${x}`)
      .raw('w IS NULL');
    expect(p.clause).toBe('WHERE x = $1 AND w IS NULL');
    expect(p.values).toEqual(['a']);
    expect(p.param(5)).toBe('$2');
    expect(new SqlParams().clause).toBe('');
    expect(new SqlParams().conditionsOnly).toBe('TRUE');
    expect(p.conditionsOnly).toBe('x = $1 AND w IS NULL');
  });
});

describe('paginate', () => {
  it('tính tổng số trang', () => {
    expect(paginate([1, 2], 21, { page: 2, limit: 10 }).meta).toEqual({
      page: 2,
      limit: 10,
      total: 21,
      totalPages: 3,
    });
  });
});
