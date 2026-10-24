import type { Response } from 'express';
import type { Fault } from '../fault-injector';

/** Thân lỗi Bitrix24 cho một loại lỗi giả. */
export function faultError(fault: Fault): {
  status: number;
  error: string;
  error_description: string;
} {
  switch (fault.error) {
    case 'QUERY_LIMIT_EXCEEDED':
      return {
        status: 503,
        error: 'QUERY_LIMIT_EXCEEDED',
        error_description: 'Too many requests',
      };
    case 'OPERATION_TIME_LIMIT':
      return {
        status: 503,
        error: 'OPERATION_TIME_LIMIT',
        error_description: 'Method is blocked due to operation time limit',
      };
    case 'ACCESS_DENIED':
      return {
        status: 401,
        error: 'ACCESS_DENIED',
        error_description: 'Access denied',
      };
    default:
      return {
        status: 500,
        error: 'INTERNAL_SERVER_ERROR',
        error_description: 'Internal server error',
      };
  }
}

/** Lỗi treo hoặc trễ: áp cho cả request. */
export function isHoldFault(fault: Fault | undefined): fault is Fault {
  return fault?.error === 'timeout' || fault?.error === 'delay';
}

/** Lỗi treo/trễ mà lệnh vẫn được thực hiện trước (timeout có after, delay). */
export function executesBeforeHold(fault: Fault): boolean {
  return fault.error === 'delay' || fault.after === true;
}

/**
 * Trả phản hồi; với lỗi treo thì không trả (client tự hết thời gian chờ), với
 * lỗi trễ thì giữ `ms` mili giây rồi mới trả.
 */
export function respond(
  res: Response,
  status: number,
  body: unknown,
  hold?: Fault,
): void {
  if (hold?.error === 'timeout') {
    // Đóng kết nối sau 2 phút để không giữ socket mãi.
    setTimeout(() => res.destroy(), 120_000).unref();
    return;
  }
  const send = () => {
    if (!res.headersSent && !res.destroyed) res.status(status).json(body);
  };
  if (hold?.error === 'delay') {
    setTimeout(send, hold.ms ?? 60_000).unref();
    return;
  }
  send();
}
