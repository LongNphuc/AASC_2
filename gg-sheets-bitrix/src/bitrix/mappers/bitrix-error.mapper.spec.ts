import { AxiosError, AxiosHeaders } from 'axios';
import {
  classifyBitrixError,
  fromErrorBody,
  toBitrixError,
} from './bitrix-error.mapper';

describe('bitrix-error.mapper', () => {
  it.each([
    [503, { error: 'QUERY_LIMIT_EXCEEDED' }, 'RATE_LIMIT'],
    [429, { error: 'OPERATION_TIME_LIMIT' }, 'OPERATION_LIMIT'],
    [401, { error: 'INVALID_CREDENTIALS' }, 'AUTH'],
    [401, { error: 'insufficient_scope' }, 'AUTH'],
    [400, { error: '', error_description: 'Not found' }, 'NOT_FOUND'],
    [
      404,
      {
        error: 'ERROR_METHOD_NOT_FOUND',
        error_description: 'Method not found',
      },
      'BAD_REQUEST',
    ],
    [500, {}, 'SERVER'],
    [400, { error: 'ERROR_CORE' }, 'BAD_REQUEST'],
  ])('HTTP %s %j → %s', (status, body, kind) => {
    expect(classifyBitrixError(status, body)).toBe(kind);
  });

  it('OPERATION_TIME_LIMIT: lấy operating_reset_at làm thời điểm gọi lại', () => {
    const error = fromErrorBody(
      429,
      {
        error: 'OPERATION_TIME_LIMIT',
        time: { operating_reset_at: 1792400000 },
      },
      'crm.lead.add',
    );
    expect(error.retryAt?.toISOString()).toBe(
      new Date(1792400000 * 1000).toISOString(),
    );
  });

  it('OPERATION_TIME_LIMIT không kèm thời điểm: giả định 10 phút', () => {
    const now = Date.parse('2026-10-15T03:00:00Z');
    const error = fromErrorBody(
      429,
      { error: 'OPERATION_TIME_LIMIT' },
      'crm.lead.add',
      now,
    );
    expect(error.retryAt?.toISOString()).toBe('2026-10-15T03:10:00.000Z');
  });

  it('QUERY_LIMIT_EXCEEDED không có thời điểm gọi lại', () => {
    expect(
      fromErrorBody(503, { error: 'QUERY_LIMIT_EXCEEDED' }, 'batch').retryAt,
    ).toBeUndefined();
  });

  it('body HTML (proxy) vẫn ra lỗi theo mã HTTP', () => {
    const axios = new AxiosError('fail', undefined, undefined, undefined, {
      status: 502,
      statusText: '',
      data: '<html>Bad gateway</html>',
      headers: {},
      config: { headers: new AxiosHeaders() },
    });
    expect(toBitrixError(axios, 'batch').kind).toBe('SERVER');
  });

  it('timeout và lỗi lạ', () => {
    expect(
      toBitrixError(new AxiosError('t', 'ECONNABORTED'), 'batch').kind,
    ).toBe('TIMEOUT');
    expect(toBitrixError('x', 'batch').kind).toBe('INVALID_RESPONSE');
  });
});
