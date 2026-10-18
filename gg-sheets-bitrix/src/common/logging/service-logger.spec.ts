import { StatusKbn } from '../kbn/status.kbn';
import { formatServiceLine } from './service-logger';

describe('formatServiceLine', () => {
  const now = new Date('2026-10-15T03:00:00.000Z');

  it('ghi đủ các cột, mã lỗi kèm tên dễ đọc', () => {
    expect(
      formatServiceLine(
        {
          method: 'push batch 2/3',
          statusKbn: StatusKbn.FAILED,
          errorKbn: 40009,
          durationMs: 7012,
          errorDetail: 'thử 3 lần\n50 hàng → chờ',
        },
        '3f9a1c2e',
        now,
      ),
    ).toBe(
      '2026-10-15T03:00:00.000Z | 3f9a1c2e | push batch 2/3 | status_kbn=10001(FAILED) | error_kbn=40009(BITRIX24.RATE_LIMIT) | 7012ms | thử 3 lần 50 hàng → chờ',
    );
  });

  it('cột trống thì ghi dấu gạch', () => {
    expect(
      formatServiceLine(
        { method: 'read', statusKbn: StatusKbn.SUCCESS },
        undefined,
        now,
      ),
    ).toBe(
      '2026-10-15T03:00:00.000Z | - | read | status_kbn=10000(SUCCESS) | error_kbn=- | - | -',
    );
  });
});
