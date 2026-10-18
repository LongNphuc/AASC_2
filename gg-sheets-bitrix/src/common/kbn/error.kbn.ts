import { HttpException } from '@nestjs/common';
import {
  ExternalApiError,
  ExternalErrorKind,
  ExternalService,
} from '../errors/external-api.error';

/**
 * Mã lỗi (error_kbn) gồm 5 chữ số, dùng chung cho DB, log và body lỗi:
 *
 *   chữ số đầu  = lỗi xảy ra ở đâu (ErrorSource)
 *   4 số cuối   = loại lỗi
 *
 * Ví dụ 40009 = Bitrix24, quá tải; 30014 = Google Sheets, không tìm thấy tab.
 */
export enum ErrorSource {
  /** Dữ liệu gửi vào: hàng trên Sheet, mapping, request. */
  REQUEST = 2,
  GOOGLE_SHEETS = 3,
  BITRIX24 = 4,
  /** Lấy access token Google (service account hoặc OAuth), đăng nhập Google. */
  GOOGLE_AUTH = 5,
  /** Điều khiển lần chạy: khóa, cooldown, hết giờ. */
  SYNC = 6,
  SYSTEM = 9,
}

/** 4 số cuối của lỗi khi gọi dịch vụ bên ngoài (nguồn 3, 4, 5). */
export const EXTERNAL_KIND_CODE: Record<ExternalErrorKind, number> = {
  TIMEOUT: 1,
  NETWORK: 2,
  AUTH: 3,
  TOKEN_EXPIRED: 4,
  RECONNECT_REQUIRED: 5,
  NOT_CONNECTED: 6,
  NOT_FOUND: 7,
  BAD_REQUEST: 8,
  RATE_LIMIT: 9,
  SERVER: 10,
  INVALID_RESPONSE: 11,
  CONFIG: 12,
  OPERATION_LIMIT: 13,
  SHEET_NOT_FOUND: 14,
};

/** Mã lỗi của dữ liệu (nguồn 2), điều khiển lần chạy (6) và hệ thống (9). */
export enum ErrorKbn {
  VALIDATION = 20001,
  UNAUTHORIZED = 20002,
  NOT_FOUND = 20003,
  MAPPING_INVALID = 20004,
  HEADER_MISSING = 20005,
  FIELD_INVALID = 20006,
  VALUE_NOT_MAPPED = 20007,
  OAUTH_STATE_INVALID = 20008,
  MAPPING_CONFLICT = 20009,
  BUSY = 60001,
  COOLDOWN = 60002,
  DEADLINE = 60003,
  LOCK_LOST = 60004,
  STALE_RECOVERED = 60005,
  ROW_NOT_LOCATED = 60007,
  UNKNOWN = 90001,
  CONFIG = 90002,
}

const SOURCE_BY_SERVICE: Record<ExternalService, ErrorSource> = {
  'google-sheets': ErrorSource.GOOGLE_SHEETS,
  bitrix24: ErrorSource.BITRIX24,
  'google-auth': ErrorSource.GOOGLE_AUTH,
};

/** Lỗi tự mang mã kbn của nó. */
export interface WithErrorKbn {
  errorKbn: number;
}

export function externalErrorKbn(
  service: ExternalService,
  kind: ExternalErrorKind,
): number {
  return SOURCE_BY_SERVICE[service] * 10000 + EXTERNAL_KIND_CODE[kind];
}

/** Suy ra error_kbn từ một lỗi bất kỳ. */
export function errorKbnOf(error: unknown): number {
  if (error instanceof ExternalApiError) {
    return externalErrorKbn(error.service, error.kind);
  }
  if (hasErrorKbn(error)) {
    return error.errorKbn;
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === 401 || status === 403) return ErrorKbn.UNAUTHORIZED;
    if (status === 404) return ErrorKbn.NOT_FOUND;
    if (status < 500) return ErrorKbn.VALIDATION;
  }
  return ErrorKbn.UNKNOWN;
}

/** Tên dễ đọc của mã lỗi, dùng trong log: 40009 -> "BITRIX24.RATE_LIMIT". */
export function describeErrorKbn(code: number): string {
  const source = ErrorSource[Math.floor(code / 10000)] ?? 'UNKNOWN_SOURCE';
  const name =
    ErrorKbn[code] ??
    Object.entries(EXTERNAL_KIND_CODE).find(
      ([, suffix]) => suffix === code % 10000,
    )?.[0] ??
    String(code);
  return `${source}.${name}`;
}

function hasErrorKbn(error: unknown): error is WithErrorKbn {
  return (
    !!error &&
    typeof error === 'object' &&
    typeof (error as Partial<WithErrorKbn>).errorKbn === 'number'
  );
}
