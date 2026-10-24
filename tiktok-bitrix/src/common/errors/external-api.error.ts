import { HttpStatus } from '@nestjs/common';

/** Dịch vụ bên ngoài mà ứng dụng gọi tới. */
export type ExternalService = 'bitrix24' | 'tiktok';

/**
 * Phân loại lỗi khi gọi API bên ngoài. Mỗi loại ứng với một cách xử lý (thử
 * lại, dừng job, báo người sửa cấu hình) và một mã HTTP trả về.
 */
export type ExternalErrorKind =
  | 'TIMEOUT' // quá thời gian chờ
  | 'NETWORK' // không kết nối được
  | 'AUTH' // sai webhook, sai access token, thiếu quyền
  | 'NOT_FOUND' // bản ghi không tồn tại
  | 'BAD_REQUEST' // dữ liệu gửi đi bị từ chối
  | 'RATE_LIMIT' // gọi quá dày
  | 'SERVER' // lỗi 5xx của dịch vụ
  | 'INVALID_RESPONSE' // phản hồi sai định dạng
  | 'CONFIG' // ứng dụng thiếu cấu hình
  | 'OPERATION_LIMIT'; // Bitrix24 OPERATION_TIME_LIMIT: method chạy quá nhiều

const HTTP_STATUS_BY_KIND: Record<ExternalErrorKind, HttpStatus> = {
  TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  NETWORK: HttpStatus.BAD_GATEWAY,
  AUTH: HttpStatus.BAD_GATEWAY,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  RATE_LIMIT: HttpStatus.SERVICE_UNAVAILABLE,
  SERVER: HttpStatus.BAD_GATEWAY,
  INVALID_RESPONSE: HttpStatus.BAD_GATEWAY,
  CONFIG: HttpStatus.INTERNAL_SERVER_ERROR,
  OPERATION_LIMIT: HttpStatus.SERVICE_UNAVAILABLE,
};

/** Loại lỗi tạm thời: thử lại sau một lúc có thể thành công. */
export const TRANSIENT_KINDS: ReadonlySet<ExternalErrorKind> = new Set([
  'TIMEOUT',
  'NETWORK',
  'RATE_LIMIT',
  'SERVER',
  'OPERATION_LIMIT',
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
}

/**
 * Lỗi chuẩn hóa khi gọi Bitrix24 hoặc TikTok. Không chứa URL hay token, nên
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

  get transient(): boolean {
    return TRANSIENT_KINDS.has(this.kind);
  }
}
