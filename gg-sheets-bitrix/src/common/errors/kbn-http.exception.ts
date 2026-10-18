import { HttpException, HttpStatus } from '@nestjs/common';
import { WithErrorKbn } from '../kbn/error.kbn';

/**
 * HttpException mang sẵn error_kbn, dùng khi một endpoint cần trả mã HTTP
 * cụ thể (409 đang chạy, 429 cooldown...) kèm mã lỗi của ứng dụng.
 */
export class KbnHttpException extends HttpException implements WithErrorKbn {
  constructor(
    status: HttpStatus,
    readonly errorKbn: number,
    error: string,
    message: string | string[],
    readonly details?: Record<string, unknown>,
  ) {
    super({ error, message, details }, status);
  }
}

/** Lỗi nghiệp vụ trong một lần chạy, mang sẵn error_kbn (không phải HTTP). */
export class KbnError extends Error implements WithErrorKbn {
  constructor(
    readonly errorKbn: number,
    message: string,
  ) {
    super(message);
    this.name = 'KbnError';
  }
}
