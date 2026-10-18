import { AxiosError, AxiosHeaders } from 'axios';
import { ExternalApiError } from '../../common/errors/external-api.error';
import {
  classifyGoogleError,
  parseRetryAfter,
  toGoogleError,
} from './google-error.mapper';

function axiosError(
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
): AxiosError {
  const error = new AxiosError('fail', undefined, undefined, undefined, {
    status,
    statusText: '',
    data,
    headers,
    config: { headers: new AxiosHeaders() },
  });
  return error;
}

describe('google-error.mapper', () => {
  it.each([
    [429, {}, 'RATE_LIMIT'],
    [403, { error: { status: 'PERMISSION_DENIED' } }, 'AUTH'],
    [403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, 'CONFIG'],
    [404, {}, 'NOT_FOUND'],
    [
      400,
      { error: { message: 'Unable to parse range: Leads!A1' } },
      'SHEET_NOT_FOUND',
    ],
    [400, { error: { message: 'Invalid value' } }, 'BAD_REQUEST'],
    [401, {}, 'TOKEN_EXPIRED'],
    [503, {}, 'SERVER'],
  ])('HTTP %i → %s', (status, body, kind) => {
    expect(classifyGoogleError(status, body)).toBe(kind);
  });

  it('429 kèm Retry-After: ghi thời điểm được gọi lại', () => {
    const now = Date.parse('2026-10-15T03:00:00Z');
    expect(parseRetryAfter('30', now)).toBe('2026-10-15T03:00:30.000Z');
    expect(parseRetryAfter('Thu, 15 Oct 2026 03:05:00 GMT', now)).toBe(
      '2026-10-15T03:05:00.000Z',
    );
    expect(parseRetryAfter(undefined, now)).toBeUndefined();

    const error = toGoogleError(
      axiosError(
        429,
        { error: { message: 'Quota exceeded' } },
        { 'retry-after': '120' },
      ),
      'đọc Sheet',
    );
    expect(error.kind).toBe('RATE_LIMIT');
    expect(error.retryAt).toBeInstanceOf(Date);
  });

  it('lỗi mạng và timeout', () => {
    const timeout = new AxiosError('timeout', 'ECONNABORTED');
    expect(toGoogleError(timeout, 'đọc Sheet').kind).toBe('TIMEOUT');
    const network = new AxiosError('down', 'ENOTFOUND');
    expect(toGoogleError(network, 'đọc Sheet').kind).toBe('NETWORK');
  });

  it('giữ nguyên ExternalApiError; lỗi lạ thành INVALID_RESPONSE', () => {
    const existing = new ExternalApiError('google-sheets', 'AUTH', 'x');
    expect(toGoogleError(existing, 'op')).toBe(existing);
    expect(toGoogleError(new Error('boom'), 'op').kind).toBe(
      'INVALID_RESPONSE',
    );
  });
});
