import { isAxiosError } from 'axios';
import { ERROR } from '../../common/constants/messages.constant';
import {
  classifyTransportError,
  ExternalApiError,
  ExternalErrorKind,
} from '../../common/errors/external-api.error';
import { BitrixErrorBody } from '../types/bitrix.types';

/** Sai webhook, thiếu quyền: thử lại không giúp được. */
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

/** Khi Bitrix24 không báo operating_reset_at: cửa sổ tính giờ là 10 phút. */
const OPERATION_WINDOW_MS = 10 * 60 * 1000;

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
  if (/not found/i.test(description) && code !== 'ERROR_METHOD_NOT_FOUND')
    return 'NOT_FOUND';
  if (httpStatus === 401 || httpStatus === 403) return 'AUTH';
  if (httpStatus !== undefined && httpStatus >= 500) return 'SERVER';
  return 'BAD_REQUEST';
}

/** Lỗi trong body (HTTP lỗi, hoặc lỗi của một lệnh trong batch). */
export function fromErrorBody(
  httpStatus: number | undefined,
  data: unknown,
  operation: string,
  now = Date.now(),
): ExternalApiError {
  const body: BitrixErrorBody = data && typeof data === 'object' ? data : {};
  const kind = classifyBitrixError(httpStatus, body);
  const reason = body.error_description || body.error || `HTTP ${httpStatus}`;
  const resetAt = body.time?.operating_reset_at;
  return new ExternalApiError(
    'bitrix24',
    kind,
    ERROR.BITRIX.REQUEST_FAILED(kind, operation, reason),
    {
      operation,
      upstreamStatus: httpStatus,
      upstreamCode: body.error || undefined,
      upstreamMessage: body.error_description || undefined,
      retryAt:
        kind === 'OPERATION_LIMIT'
          ? new Date(
              resetAt ? resetAt * 1000 : now + OPERATION_WINDOW_MS,
            ).toISOString()
          : undefined,
    },
  );
}

/** Chuyển mọi lỗi khi gọi Bitrix24 thành ExternalApiError. */
export function toBitrixError(
  error: unknown,
  operation: string,
): ExternalApiError {
  if (error instanceof ExternalApiError) return error;
  const transport = classifyTransportError(error, 'bitrix24', operation);
  if (transport) return transport;
  if (isAxiosError(error) && error.response) {
    return fromErrorBody(error.response.status, error.response.data, operation);
  }
  return new ExternalApiError(
    'bitrix24',
    'INVALID_RESPONSE',
    ERROR.EXTERNAL.UNKNOWN('bitrix24', operation, String(error)),
    { operation },
  );
}
