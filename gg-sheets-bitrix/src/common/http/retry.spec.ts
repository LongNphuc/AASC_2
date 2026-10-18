import { ExternalApiError } from '../errors/external-api.error';
import { backoffDelay, CooldownRequiredError, withRetry } from './retry';

const policy = { maxRetries: 3, baseDelayMs: 1000, maxInlineWaitMs: 10_000 };
const rateLimit = (retryAt?: string) =>
  new ExternalApiError('bitrix24', 'RATE_LIMIT', 'quá tải', { retryAt });
const authError = () => new ExternalApiError('bitrix24', 'AUTH', 'sai webhook');

describe('withRetry', () => {
  const sleep = jest.fn().mockResolvedValue(undefined);
  beforeEach(() => sleep.mockClear());

  it('lỗi tạm thời: chờ tăng dần rồi thử lại, thành công thì trả kết quả', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(rateLimit())
      .mockRejectedValueOnce(rateLimit())
      .mockResolvedValue('ok');

    await expect(
      withRetry(fn, policy, { sleep, random: () => 0 }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it('thử đủ maxRetries lần vẫn lỗi thì ném lỗi cuối', async () => {
    const fn = jest.fn().mockRejectedValue(rateLimit());
    await expect(
      withRetry(fn, policy, { sleep, random: () => 0 }),
    ).rejects.toThrow('quá tải');
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('lỗi không tạm thời (sai webhook) thì không thử lại', async () => {
    const fn = jest.fn().mockRejectedValue(authError());
    await expect(withRetry(fn, policy, { sleep })).rejects.toThrow(
      'sai webhook',
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('isRetryable riêng có thể tắt thử lại (timeout khi tạo lead)', async () => {
    const timeout = new ExternalApiError('bitrix24', 'TIMEOUT', 'timeout');
    const fn = jest.fn().mockRejectedValue(timeout);
    await expect(
      withRetry(fn, policy, { sleep, isRetryable: () => false }),
    ).rejects.toBe(timeout);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('API báo thời điểm gọi lại xa hơn maxInlineWaitMs: ném CooldownRequiredError, không chờ', async () => {
    const now = Date.parse('2026-10-15T03:00:00Z');
    const fn = jest.fn().mockRejectedValue(rateLimit('2026-10-15T03:10:00Z'));

    const error = await withRetry(fn, policy, { sleep, now: () => now }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CooldownRequiredError);
    expect((error as CooldownRequiredError).retryAt.toISOString()).toBe(
      '2026-10-15T03:10:00.000Z',
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  it('thời điểm gọi lại gần (trong maxInlineWaitMs): chờ đúng tới lúc đó', async () => {
    const now = Date.parse('2026-10-15T03:00:00Z');
    const fn = jest
      .fn()
      .mockRejectedValueOnce(rateLimit('2026-10-15T03:00:04Z'))
      .mockResolvedValue('ok');

    await expect(
      withRetry(fn, policy, { sleep, now: () => now }),
    ).resolves.toBe('ok');
    expect(sleep).toHaveBeenCalledWith(4000);
  });

  it('canWait trả false (sắp hết giờ) thì dừng, ném lỗi', async () => {
    const fn = jest.fn().mockRejectedValue(rateLimit());
    await expect(
      withRetry(fn, policy, { sleep, canWait: () => false }),
    ).rejects.toThrow('quá tải');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gọi onRetry trước mỗi lần chờ', async () => {
    const onRetry = jest.fn();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(rateLimit())
      .mockResolvedValue(1);
    await withRetry(fn, policy, { sleep, onRetry, random: () => 0 });
    expect(onRetry).toHaveBeenCalledWith(expect.any(ExternalApiError), 1, 1000);
  });
});

describe('backoffDelay', () => {
  it('gấp đôi mỗi lần, cộng ngẫu nhiên tới 1 giây', () => {
    expect(backoffDelay(1000, 0, () => 0)).toBe(1000);
    expect(backoffDelay(1000, 2, () => 0.5)).toBe(4500);
  });
});
