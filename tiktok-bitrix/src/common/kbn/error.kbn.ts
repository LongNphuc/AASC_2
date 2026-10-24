import { HttpException } from '@nestjs/common';
import {
  ExternalApiError,
  ExternalErrorKind,
  ExternalService,
} from '../errors/external-api.error';

/**
 * Mã lỗi (error_kbn) gồm 5 chữ số, dùng chung cho DB, log, lý do lỗi của job
 * (failedReason) và trường errorKbn trong body lỗi (readme_design.md mục 12.2):
 *
 *   chữ số đầu  = lỗi xảy ra ở đâu (ErrorSource)
 *   4 số cuối   = loại lỗi
 *
 * Ví dụ 40009 = Bitrix24, quá tải; 30003 = TikTok, sai access token.
 */
export enum ErrorSource {
  /** Dữ liệu vào: webhook, request, cấu hình. */
  REQUEST = 2,
  TIKTOK = 3,
  BITRIX24 = 4,
  /** Job: chạy lại, deal không thuộc ứng dụng. */
  JOB = 6,
  SYSTEM = 9,
}

/** 4 số cuối của lỗi khi gọi dịch vụ bên ngoài (nguồn 3, 4). */
export const EXTERNAL_KIND_CODE: Record<ExternalErrorKind, number> = {
  TIMEOUT: 1,
  NETWORK: 2,
  AUTH: 3,
  NOT_FOUND: 7,
  BAD_REQUEST: 8,
  RATE_LIMIT: 9,
  SERVER: 10,
  INVALID_RESPONSE: 11,
  CONFIG: 12,
  OPERATION_LIMIT: 13,
};

/** Mã lỗi của dữ liệu (nguồn 2), job (6) và bên trong ứng dụng (9). */
export enum ErrorKbn {
  VALIDATION = 20001,
  UNAUTHORIZED = 20002,
  NOT_FOUND = 20003,
  CONFIG_INVALID = 20004,
  FIELD_INVALID = 20006,
  CONFIG_CONFLICT = 20009,
  SIGNATURE_INVALID = 20010,
  SIGNATURE_EXPIRED = 20011,
  BITRIX_TOKEN_INVALID = 20012,
  DEAL_ALREADY_OPEN = 20013,
  NO_CONTACT_INFO = 20014,
  TOO_MANY_REQUESTS = 20016,
  LEAD_NOT_IN_CRM = 20017,
  SUBMISSION_HAS_DEAL = 20018,
  RETRY_EXHAUSTED = 60010,
  DEAL_NOT_OWNED = 60011,
  UNKNOWN = 90001,
  CONFIG = 90002,
  DB_TRANSIENT = 90003,
  REDIS_TRANSIENT = 90004,
}

const SOURCE_BY_SERVICE: Record<ExternalService, ErrorSource> = {
  tiktok: ErrorSource.TIKTOK,
  bitrix24: ErrorSource.BITRIX24,
};

/**
 * Lỗi tạm thời: BullMQ thử lại, batch recovery chạy lại
 * (readme_design.md mục 12.2).
 */
const TRANSIENT_ERROR_KBN: ReadonlySet<number> = new Set([
  30001,
  30002,
  30009,
  30010,
  40001,
  40002,
  40009,
  40010,
  40013,
  ErrorKbn.DB_TRANSIENT,
  ErrorKbn.REDIS_TRANSIENT,
]);

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
    if (status === 429) return ErrorKbn.TOO_MANY_REQUESTS;
    if (status < 500) return ErrorKbn.VALIDATION;
  }
  const fromMessage = kbnFromFailedReason(
    error instanceof Error ? error.message : undefined,
  );
  if (fromMessage) return fromMessage;
  if (isTransientDbError(error)) return ErrorKbn.DB_TRANSIENT;
  if (isTransientRedisError(error)) return ErrorKbn.REDIS_TRANSIENT;
  return ErrorKbn.UNKNOWN;
}

export function isTransientErrorKbn(code: number | null | undefined): boolean {
  return code !== null && code !== undefined && TRANSIENT_ERROR_KBN.has(code);
}

/** Danh sách mã lỗi tạm thời, dùng trong truy vấn của batch recovery. */
export function transientErrorKbns(): number[] {
  return [...TRANSIENT_ERROR_KBN];
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

/**
 * Đọc mã lỗi ở đầu lý do lỗi của job ("40009 BITRIX24.RATE_LIMIT: …",
 * job-error.ts). Không có mã thì undefined.
 */
export function kbnFromFailedReason(
  reason: string | null | undefined,
): number | undefined {
  const match = /^([2-9]\d{4}) /.exec(reason ?? '');
  return match ? Number(match[1]) : undefined;
}

/**
 * Lỗi DB có thể hết khi thử lại: mất kết nối, DB đang khởi động lại, deadlock,
 * xung đột tuần tự hóa.
 */
export function isTransientDbError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown; driverError?: { code?: unknown } })
    .code;
  const driverCode = (error as { driverError?: { code?: unknown } }).driverError
    ?.code;
  const raw = driverCode ?? code;
  const value =
    typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
  return (
    /^(08|57P0)/.test(value) ||
    ['40001', '40P01', '53300', 'ECONNREFUSED', 'ECONNRESET'].includes(value)
  );
}

/**
 * Lỗi của ioredis khi Redis sập hoặc chập chờn (redis.module.ts đặt
 * enableOfflineQueue: false, maxRetriesPerRequest: 1 nên lỗi ngay, không
 * treo). ioredis ném Error thường không có code, nên nhận theo tên và câu.
 */
const REDIS_TRANSIENT_MESSAGES = [
  "Stream isn't writeable",
  'Connection is closed',
  'Reached the max retries per request limit',
];

export function isTransientRedisError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'MaxRetriesPerRequestError') return true;
  return (
    typeof message === 'string' &&
    REDIS_TRANSIENT_MESSAGES.some((text) => message.includes(text))
  );
}

function hasErrorKbn(error: unknown): error is WithErrorKbn {
  return (
    !!error &&
    typeof error === 'object' &&
    typeof (error as Partial<WithErrorKbn>).errorKbn === 'number'
  );
}
