import { HttpStatus } from '@nestjs/common';
import { isAxiosError } from 'axios';
import { ERROR } from '../constants/messages.constant';

/** Dịch vụ bên ngoài mà ứng dụng gọi tới. */
export type ExternalService = 'google-sheets' | 'bitrix24' | 'google-auth';

/**
 * Phân loại lỗi khi gọi API bên ngoài. Mỗi loại ứng với một cách xử lý (thử
 * lại, ghi cooldown, báo người dùng sửa cấu hình...) và một mã HTTP trả về.
 */
export type ExternalErrorKind =
  | 'TIMEOUT' // quá thời gian chờ
  | 'NETWORK' // không kết nối được
  | 'AUTH' // sai thông tin xác thực, thiếu quyền, chưa share Sheet
  | 'TOKEN_EXPIRED' // access token Google hết hạn hoặc bị Google từ chối
  | 'RECONNECT_REQUIRED' // refresh token Google hỏng: phải đăng nhập lại
  | 'NOT_CONNECTED' // chưa có token Google: chưa đăng nhập (OAuth) hoặc batch token chưa chạy
  | 'NOT_FOUND' // bản ghi hoặc Sheet không tồn tại
  | 'BAD_REQUEST' // dữ liệu gửi đi bị từ chối
  | 'RATE_LIMIT' // gọi quá dày
  | 'SERVER' // lỗi 5xx của dịch vụ
  | 'INVALID_RESPONSE' // phản hồi sai định dạng
  | 'CONFIG' // ứng dụng thiếu cấu hình
  | 'OPERATION_LIMIT' // Bitrix24 OPERATION_TIME_LIMIT: method chạy quá nhiều
  | 'SHEET_NOT_FOUND'; // không có tab GOOGLE_SHEET_NAME

const HTTP_STATUS_BY_KIND: Record<ExternalErrorKind, HttpStatus> = {
  TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  NETWORK: HttpStatus.BAD_GATEWAY,
  AUTH: HttpStatus.BAD_GATEWAY,
  TOKEN_EXPIRED: HttpStatus.BAD_GATEWAY,
  RECONNECT_REQUIRED: HttpStatus.SERVICE_UNAVAILABLE,
  NOT_CONNECTED: HttpStatus.SERVICE_UNAVAILABLE,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  RATE_LIMIT: HttpStatus.SERVICE_UNAVAILABLE,
  SERVER: HttpStatus.BAD_GATEWAY,
  INVALID_RESPONSE: HttpStatus.BAD_GATEWAY,
  CONFIG: HttpStatus.INTERNAL_SERVER_ERROR,
  OPERATION_LIMIT: HttpStatus.SERVICE_UNAVAILABLE,
  SHEET_NOT_FOUND: HttpStatus.BAD_REQUEST,
};

/** Loại lỗi tạm thời: thử lại sau một lúc có thể thành công. */
export const TRANSIENT_KINDS: ReadonlySet<ExternalErrorKind> = new Set([
  'TIMEOUT',
  'NETWORK',
  'RATE_LIMIT',
  'SERVER',
]);

export interface ExternalErrorDetails {
  /** Method hoặc thao tác đã gọi, ví dụ `crm.lead.add`. */
  operation?: string;
  /** Mã HTTP dịch vụ trả về (nếu có). */
  upstreamStatus?: number;
  /** Mã lỗi của dịch vụ, ví dụ `QUERY_LIMIT_EXCEEDED`. */
  upstreamCode?: string;
  /** Mô tả lỗi gốc của dịch vụ. */
  upstreamMessage?: string;
  /** Dịch vụ cho gọi lại từ thời điểm này (Retry-After, operating_reset_at). */
  retryAt?: string;
}

/**
 * Lỗi chuẩn hóa khi gọi Google hoặc Bitrix24. Không chứa URL hay token, nên
 * ghi log và trả về client an toàn.
 */
export class ExternalApiError extends Error {
  constructor(
    readonly service: ExternalService,
    readonly kind: ExternalErrorKind,
    message: string,
    readonly details: ExternalErrorDetails = {},
  ) {
    super(message);
    this.name = 'ExternalApiError';
  }

  get httpStatus(): HttpStatus {
    return HTTP_STATUS_BY_KIND[this.kind];
  }

  get retryAt(): Date | undefined {
    return this.details.retryAt ? new Date(this.details.retryAt) : undefined;
  }

  get transient(): boolean {
    return TRANSIENT_KINDS.has(this.kind);
  }
}

/**
 * Phân loại lỗi tầng mạng của axios (chưa nhận được phản hồi HTTP).
 * Trả về null nếu đã có phản hồi, để bên gọi tự đọc mã lỗi của dịch vụ.
 */
export function classifyTransportError(
  error: unknown,
  service: ExternalService,
  operation: string,
): ExternalApiError | null {
  if (!isAxiosError(error) || error.response) {
    return null;
  }
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return new ExternalApiError(
      service,
      'TIMEOUT',
      ERROR.EXTERNAL.TIMEOUT(service, operation),
      { operation },
    );
  }
  return new ExternalApiError(
    service,
    'NETWORK',
    ERROR.EXTERNAL.NETWORK(service, operation, error.code),
    { operation },
  );
}
