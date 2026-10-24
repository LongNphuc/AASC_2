import { ExternalApiError } from '../common/errors/external-api.error';
import { toBatchCommand, toQueryString } from './mappers/batch-command.mapper';
import {
  classifyBitrixError,
  fromErrorBody,
  isNotFound,
  toBitrixError,
} from './mappers/bitrix-error.mapper';

describe('batch-command.mapper', () => {
  it('dựng query string kiểu PHP, bỏ null/undefined, mã hóa giá trị', () => {
    expect(
      toQueryString({
        fields: {
          NAME: 'Nguyễn A',
          PHONE: [{ VALUE: '+84901234567' }],
          EMPTY: null,
          N: 5,
          OK: true,
        },
        id: 3,
      }),
    ).toBe(
      'fields[NAME]=Nguy%E1%BB%85n%20A&fields[PHONE][0][VALUE]=%2B84901234567&fields[N]=5&fields[OK]=true&id=3',
    );
    expect(toBatchCommand({ method: 'crm.lead.get', params: { id: 1 } })).toBe(
      'crm.lead.get?id=1',
    );
    expect(toBatchCommand({ method: 'crm.lead.fields', params: {} })).toBe(
      'crm.lead.fields',
    );
  });
});

describe('bitrix-error.mapper', () => {
  it.each([
    [503, { error: 'QUERY_LIMIT_EXCEEDED' }, 'RATE_LIMIT'],
    [429, {}, 'RATE_LIMIT'],
    [503, { error: 'OPERATION_TIME_LIMIT' }, 'OPERATION_LIMIT'],
    [401, { error: 'ACCESS_DENIED' }, 'AUTH'],
    [403, {}, 'AUTH'],
    [400, { error: 'NOT_FOUND' }, 'NOT_FOUND'],
    [400, { error: '', error_description: 'Not found' }, 'NOT_FOUND'],
    [
      404,
      {
        error: 'ERROR_METHOD_NOT_FOUND',
        error_description: 'Method not found',
      },
      'BAD_REQUEST',
    ],
    [500, { error: 'INTERNAL_SERVER_ERROR' }, 'SERVER'],
    [200, {}, 'INVALID_RESPONSE'],
    [400, { error: 'ERROR_CORE' }, 'BAD_REQUEST'],
    [undefined, {}, 'BAD_REQUEST'],
  ])('HTTP %s + %j → %s', (status, body, kind) => {
    expect(classifyBitrixError(status, body)).toBe(kind);
  });

  it('fromErrorBody giữ mã, mô tả gốc; body không phải object vẫn đọc được', () => {
    const error = fromErrorBody(
      400,
      { error: 'ERROR_CORE', error_description: 'Sai field' },
      'crm.lead.add',
    );
    expect(error).toBeInstanceOf(ExternalApiError);
    expect(error).toMatchObject({
      service: 'bitrix24',
      kind: 'BAD_REQUEST',
      details: {
        operation: 'crm.lead.add',
        upstreamStatus: 400,
        upstreamCode: 'ERROR_CORE',
        upstreamMessage: 'Sai field',
      },
    });
    expect(error.message).toContain('Sai field');
    expect(fromErrorBody(502, 'html', 'x')).toMatchObject({
      kind: 'SERVER',
      message: expect.stringContaining('HTTP 502') as string,
    });
  });

  it('toBitrixError giữ ExternalApiError, bọc lỗi lạ; isNotFound', () => {
    const known = fromErrorBody(400, { error: 'NOT_FOUND' }, 'crm.item.get');
    expect(toBitrixError(known, 'x')).toBe(known);
    expect(toBitrixError(new Error('boom'), 'crm.lead.add')).toMatchObject({
      kind: 'INVALID_RESPONSE',
      details: { operation: 'crm.lead.add' },
    });
    expect(isNotFound(known)).toBe(true);
    expect(isNotFound(new Error('x'))).toBe(false);
  });
});
