import { ExternalApiError } from '../errors/external-api.error';
import { sleep as realSleep } from './sleep';

export interface RetryPolicy {
  /** Số lần thử lại tối đa sau lần gọi đầu (RETRY_MAX_ATTEMPTS). */
  maxRetries: number;
  /** Thời gian chờ trước lần thử lại đầu tiên; các lần sau gấp đôi. */
  baseDelayMs: number;
  /** Chờ lâu hơn mức này thì không ngồi chờ mà báo cooldown. */
  maxInlineWaitMs: number;
}

/**
 * API báo phải chờ tới một thời điểm cách quá xa để ngồi chờ ngay trong lần
 * chạy (Bitrix24 OPERATION_TIME_LIMIT, Google Retry-After dài). Bên gọi ghi
 * cooldown_until rồi dừng gửi.
 */
export class CooldownRequiredError extends Error {
  constructor(
    readonly error: ExternalApiError,
    readonly retryAt: Date,
  ) {
    super(error.message);
    this.name = 'CooldownRequiredError';
  }
}

export interface RetryOptions {
  /** Có thử lại lỗi này không. Mặc định: lỗi tạm thời (timeout, mạng, quá tải, 5xx). */
  isRetryable?: (error: unknown) => boolean;
  /** Trả false nếu chờ thêm `delayMs` sẽ vượt thời gian tối đa của lần chạy. */
  canWait?: (delayMs: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export const defaultRetryable = (error: unknown): boolean =>
  error instanceof ExternalApiError && error.transient;

/** Thời gian chờ trước lần thử lại thứ `attempt + 1`: tăng gấp đôi, cộng ngẫu nhiên tới 1 giây. */
export function backoffDelay(
  baseDelayMs: number,
  attempt: number,
  random: () => number = Math.random,
): number {
  return baseDelayMs * 2 ** attempt + Math.floor(random() * 1000);
}

/**
 * Gọi `fn`; lỗi tạm thời thì chờ (backoff tăng dần) rồi gọi lại, tối đa
 * `maxRetries` lần. API báo rõ thời điểm gọi lại:
 * - trong `maxInlineWaitMs` thì chờ đúng tới thời điểm đó rồi gọi lại;
 * - xa hơn thì ném CooldownRequiredError, không ngồi chờ.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  options: RetryOptions = {},
): Promise<T> {
  const isRetryable = options.isRetryable ?? defaultRetryable;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryAt =
        error instanceof ExternalApiError ? error.retryAt : undefined;
      const untilRetryAt = retryAt ? retryAt.getTime() - now() : undefined;
      if (
        error instanceof ExternalApiError &&
        retryAt &&
        untilRetryAt! > policy.maxInlineWaitMs
      ) {
        throw new CooldownRequiredError(error, retryAt);
      }
      const retryable = retryAt ? true : isRetryable(error);
      if (!retryable || attempt >= policy.maxRetries) {
        throw error;
      }
      const delay =
        untilRetryAt !== undefined
          ? Math.max(0, untilRetryAt)
          : backoffDelay(policy.baseDelayMs, attempt, options.random);
      if (options.canWait && !options.canWait(delay)) {
        throw error;
      }
      options.onRetry?.(error, attempt + 1, delay);
      await sleep(delay);
    }
  }
}
