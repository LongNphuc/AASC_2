import { UnrecoverableError } from 'bullmq';
import { ExternalApiError } from './external-api.error';
import { isUnrecoverable, toJobError } from './job-error';
import { KbnError } from './kbn-http.exception';

describe('toJobError', () => {
  it('lỗi tạm thời: Error thường, message mang mã lỗi', () => {
    const error = toJobError(
      new ExternalApiError('bitrix24', 'RATE_LIMIT', 'quá tải'),
    );
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(error.message).toBe('40009 BITRIX24.RATE_LIMIT: quá tải');
    expect(isUnrecoverable(error)).toBe(false);
  });

  it('lỗi đã biết không thử lại được: UnrecoverableError', () => {
    expect(
      toJobError(new ExternalApiError('bitrix24', 'AUTH', 'sai quyền')),
    ).toBeInstanceOf(UnrecoverableError);
    expect(
      isUnrecoverable(toJobError(new KbnError(20004, 'cấu hình sai'))),
    ).toBe(true);
    expect(toJobError(new UnrecoverableError('40008 x: y'))).toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('Redis chập chờn: lỗi tạm thời 90004, không phải 90001', () => {
    const error = toJobError(
      new Error(
        "Stream isn't writeable and enableOfflineQueue options is false",
      ),
    );
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(error.message).toMatch(/^90004 SYSTEM\.REDIS_TRANSIENT: /);
  });

  it('lỗi không lường trước: vẫn cho BullMQ thử lại, không thêm mã hai lần', () => {
    const error = toJobError(new Error('null pointer'));
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(error.message).toBe('90001 SYSTEM.UNKNOWN: null pointer');
    expect(toJobError(new Error('90001 SYSTEM.UNKNOWN: a')).message).toBe(
      '90001 SYSTEM.UNKNOWN: a',
    );
    expect(toJobError('chuỗi').message).toContain('chuỗi');
  });

  it('ExternalApiError cho biết mã HTTP và tính tạm thời', () => {
    const error = new ExternalApiError('tiktok', 'TIMEOUT', 'chậm', {
      operation: 'event/track',
    });
    expect(error.httpStatus).toBe(504);
    expect(error.transient).toBe(true);
    expect(new ExternalApiError('tiktok', 'BAD_REQUEST', 'x').transient).toBe(
      false,
    );
  });
});
