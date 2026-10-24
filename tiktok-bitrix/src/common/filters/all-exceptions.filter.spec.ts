import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ExternalApiError } from '../errors/external-api.error';
import { KbnHttpException } from '../errors/kbn-http.exception';
import { ErrorKbn } from '../kbn/error.kbn';
import {
  AllExceptionsFilter,
  type ErrorResponseBody,
} from './all-exceptions.filter';

/** Chạy filter với request/response giả, trả mã HTTP, header, body. */
function run(exception: unknown, path = '/api/v1/leads') {
  const result = {
    status: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown as ErrorResponseBody,
  };
  const response = {
    locals: {} as Record<string, unknown>,
    on: () => undefined,
    setHeader: (name: string, value: string) => (result.headers[name] = value),
    status(code: number) {
      result.status = code;
      return this;
    },
    json: (body: ErrorResponseBody) => (result.body = body),
  };
  const request = { path, method: 'GET', originalUrl: path };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return result;
}

describe('AllExceptionsFilter', () => {
  it('KbnHttpException: giữ mã, nhãn, details', () => {
    const { status, body } = run(
      new KbnHttpException(
        409,
        ErrorKbn.DEAL_ALREADY_OPEN,
        'DEAL_ALREADY_OPEN',
        'Đã có deal',
        { dealUuid: 'x' },
      ),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({
      statusCode: 409,
      error: 'DEAL_ALREADY_OPEN',
      errorKbn: ErrorKbn.DEAL_ALREADY_OPEN,
      message: 'Đã có deal',
      details: { dealUuid: 'x' },
      path: '/api/v1/leads',
    });
  });

  it('HttpException của Nest: object hoặc chuỗi', () => {
    expect(run(new NotFoundException()).body).toMatchObject({
      statusCode: 404,
      error: 'NOT_FOUND',
      errorKbn: ErrorKbn.NOT_FOUND,
    });
    expect(run(new BadRequestException(['a', 'b'])).body).toMatchObject({
      statusCode: 400,
      message: ['a', 'b'],
    });
    expect(run(new HttpException('Tạm ngưng', 503)).body).toMatchObject({
      statusCode: 503,
      error: 'SERVICE_UNAVAILABLE',
      message: 'Tạm ngưng',
    });
  });

  it('429: nhãn TOO_MANY_REQUESTS, có details thì đặt Retry-After', () => {
    const throttled = run(
      new KbnHttpException(
        429,
        ErrorKbn.TOO_MANY_REQUESTS,
        'TOO_MANY_REQUESTS',
        'chậm lại',
        { retryAfterSeconds: 30 },
      ),
    );
    expect(throttled.headers['Retry-After']).toBe('30');
    expect(throttled.body.details).toEqual({ retryAfterSeconds: 30 });
    const plain = run(new ThrottlerException());
    expect(plain.status).toBe(429);
    expect(plain.headers).toEqual({});
    expect(plain.body).toMatchObject({
      error: 'TOO_MANY_REQUESTS',
      errorKbn: ErrorKbn.TOO_MANY_REQUESTS,
    });
  });

  it('ExternalApiError: đổi sang mã HTTP theo loại lỗi, mã lỗi theo dịch vụ', () => {
    const { status, body } = run(
      new ExternalApiError('bitrix24', 'RATE_LIMIT', 'quá tải', {
        operation: 'crm.lead.fields',
      }),
      '/api/v1/bitrix/lead-fields',
    );
    expect(status).toBe(503);
    expect(body).toMatchObject({
      error: 'BITRIX24_RATE_LIMIT',
      errorKbn: 40009,
      details: { operation: 'crm.lead.fields' },
    });
    expect(
      run(new ExternalApiError('tiktok', 'BAD_REQUEST', 'sai')).status,
    ).toBeLessThan(500);
  });

  it('lỗi khác (DB, Redis sập): 500, không lộ chi tiết', () => {
    const { status, body } = run(
      new Error('connect ECONNREFUSED 127.0.0.1:5432'),
      '/webhooks/tiktok/leads',
    );
    expect(status).toBe(500);
    expect(body).toMatchObject({ statusCode: 500, errorKbn: ErrorKbn.UNKNOWN });
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(run('chuỗi lạ').status).toBe(500);
  });
});
