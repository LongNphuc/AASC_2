import { UnrecoverableError } from 'bullmq';
import {
  describeErrorKbn,
  errorKbnOf,
  ErrorKbn,
  isTransientErrorKbn,
} from '../kbn/error.kbn';

/**
 * Đổi lỗi của một bước thành lỗi ném cho BullMQ (readme_design.md mục 10.2),
 * message có dạng "40009 BITRIX24.RATE_LIMIT: Bitrix24 lỗi RATE_LIMIT (…)"
 * để failedReason của job mang sẵn mã lỗi (kbnFromFailedReason đọc lại):
 *
 * - lỗi tạm thời (timeout, quá tải, lỗi máy chủ, lỗi DB tạm thời): Error
 *   thường, BullMQ thử lại cả job;
 * - lỗi đã biết mà thử lại không giúp được (sai quyền, Bitrix24 từ chối dữ
 *   liệu, dữ liệu sai): UnrecoverableError, job vào failed ngay;
 * - lỗi không lường trước (90001): Error thường, vẫn được BullMQ thử lại vài
 *   giây, nhưng batch recovery không chạy lại vì không phải lỗi tạm thời.
 */
export function toJobError(error: unknown): Error {
  const errorKbn = errorKbnOf(error);
  const reason = error instanceof Error ? error.message : String(error);
  const message = reason.startsWith(`${errorKbn} `)
    ? reason
    : `${errorKbn} ${describeErrorKbn(errorKbn)}: ${reason}`;
  if (
    error instanceof UnrecoverableError ||
    (!isTransientErrorKbn(errorKbn) && errorKbn !== ErrorKbn.UNKNOWN)
  ) {
    return new UnrecoverableError(message);
  }
  const wrapped = new Error(message);
  wrapped.stack = error instanceof Error ? error.stack : wrapped.stack;
  return wrapped;
}

/** Lỗi đã được đổi thành UnrecoverableError (không thử lại). */
export function isUnrecoverable(error: unknown): boolean {
  return error instanceof UnrecoverableError;
}
