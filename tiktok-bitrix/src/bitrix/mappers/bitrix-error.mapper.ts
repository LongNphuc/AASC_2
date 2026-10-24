import { ERROR } from '../../common/constants/messages.constant';
import {
  ExternalApiError,
  type ExternalErrorKind,
} from '../../common/errors/external-api.error';
import type { BitrixErrorBody } from '../types/bitrix.types';

/** Sai webhook, thiếu quyền: thử lại không giúp được (40003). */
const AUTH_CODES = new Set([
  'NO_AUTH_FOUND',
  'INVALID_CREDENTIALS',
  'WRONG_AUTH_TYPE',
  'insufficient_scope',
  'ACCESS_DENIED',
  'authorization_error',
  'user_access_error',
  'expired_token',
  'invalid_token',
]);

/** Xếp lỗi Bitrix24 vào một loại: mã lỗi trong body trước, mã HTTP sau. */
export function classifyBitrixError(
  httpStatus: number | undefined,
  body: BitrixErrorBody,
): ExternalErrorKind {
  const code = body.error ?? '';
  const description = body.error_description ?? '';
  if (code === 'OPERATION_TIME_LIMIT') return 'OPERATION_LIMIT';
  if (code === 'QUERY_LIMIT_EXCEEDED' || httpStatus === 429)
    return 'RATE_LIMIT';
  if (AUTH_CODES.has(code)) return 'AUTH';
  if (
    code === 'NOT_FOUND' ||
    (/not found/i.test(description) && code !== 'ERROR_METHOD_NOT_FOUND')
  )
    return 'NOT_FOUND';
  if (httpStatus === 401 || httpStatus === 403) return 'AUTH';
  if (httpStatus !== undefined && httpStatus >= 500) return 'SERVER';
  if (httpStatus !== undefined && httpStatus < 400 && !code)
    return 'INVALID_RESPONSE';
  return 'BAD_REQUEST';
}

/** Lỗi trong body (HTTP lỗi, hoặc lỗi của một lệnh trong batch). */
export function fromErrorBody(
  httpStatus: number | undefined,
  data: unknown,
  operation: string,
): ExternalApiError {
  const body: BitrixErrorBody = data && typeof data === 'object' ? data : {};
  const kind = classifyBitrixError(httpStatus, body);
  const reason = body.error_description || body.error || `HTTP ${httpStatus}`;
  return new ExternalApiError(
    'bitrix24',
    kind,
    ERROR.BITRIX.REQUEST_FAILED(kind, operation, reason),
    {
      operation,
      upstreamStatus: httpStatus,
      upstreamCode: body.error || undefined,
      upstreamMessage: body.error_description || undefined,
    },
  );
}

/** Chuyển mọi lỗi khi gọi Bitrix24 thành ExternalApiError. */
export function toBitrixError(
  error: unknown,
  operation: string,
): ExternalApiError {
  if (error instanceof ExternalApiError) return error;
  return new ExternalApiError(
    'bitrix24',
    'INVALID_RESPONSE',
    ERROR.EXTERNAL.UNKNOWN('bitrix24', operation, String(error)),
    { operation },
  );
}

/** Bản ghi đích không còn trên CRM (sales xóa hoặc gộp). */
export function isNotFound(error: unknown): boolean {
  return error instanceof ExternalApiError && error.kind === 'NOT_FOUND';
}
