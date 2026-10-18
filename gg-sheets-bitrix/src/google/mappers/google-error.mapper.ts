import { isAxiosError } from 'axios';
import { ERROR } from '../../common/constants/messages.constant';
import {
  classifyTransportError,
  ExternalApiError,
  ExternalErrorKind,
  ExternalService,
} from '../../common/errors/external-api.error';
import { GoogleErrorBody } from '../types/sheets.types';

/** Xếp lỗi Google API vào một loại theo mã HTTP và nội dung body. */
export function classifyGoogleError(
  httpStatus: number,
  body: GoogleErrorBody,
): ExternalErrorKind {
  const status = body.error?.status ?? '';
  const message = body.error?.message ?? '';
  const reasons = (body.error?.details ?? []).map((d) => d.reason ?? '');
  if (httpStatus === 429 || status === 'RESOURCE_EXHAUSTED')
    return 'RATE_LIMIT';
  if (httpStatus === 401) return 'TOKEN_EXPIRED';
  if (reasons.includes('SERVICE_DISABLED')) return 'CONFIG';
  if (httpStatus === 403) return 'AUTH';
  if (httpStatus === 404) return 'NOT_FOUND';
  if (httpStatus === 400 && /Unable to parse range/i.test(message))
    return 'SHEET_NOT_FOUND';
  if (httpStatus >= 500) return 'SERVER';
  return 'BAD_REQUEST';
}

/**
 * Header Retry-After: số giây, hoặc một mốc thời gian HTTP. Trả về thời điểm
 * được gọi lại dạng ISO, hoặc undefined nếu không có / không đọc được.
 */
export function parseRetryAfter(
  value: unknown,
  now = Date.now(),
): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds))
    return new Date(now + seconds * 1000).toISOString();
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : new Date(date).toISOString();
}

/** Chuyển mọi lỗi khi gọi Google thành ExternalApiError. */
export function toGoogleError(
  error: unknown,
  operation: string,
  service: ExternalService = 'google-sheets',
): ExternalApiError {
  if (error instanceof ExternalApiError) return error;
  const transport = classifyTransportError(error, service, operation);
  if (transport) return transport;
  if (isAxiosError(error) && error.response) {
    const data: unknown = error.response.data;
    const body: GoogleErrorBody = data && typeof data === 'object' ? data : {};
    const kind = classifyGoogleError(error.response.status, body);
    const reason = body.error?.message || `HTTP ${error.response.status}`;
    const headers = error.response.headers as
      Record<string, unknown> | undefined;
    return new ExternalApiError(
      service,
      kind,
      ERROR.GOOGLE.REQUEST_FAILED(kind, operation, reason),
      {
        operation,
        upstreamStatus: error.response.status,
        upstreamCode: body.error?.status,
        upstreamMessage: body.error?.message,
        retryAt:
          kind === 'RATE_LIMIT'
            ? parseRetryAfter(headers?.['retry-after'])
            : undefined,
      },
    );
  }
  return new ExternalApiError(
    service,
    'INVALID_RESPONSE',
    ERROR.EXTERNAL.UNKNOWN(service, operation, String(error)),
    { operation },
  );
}
