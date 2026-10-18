import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { ExternalApiError } from '../errors/external-api.error';
import { KbnHttpException } from '../errors/kbn-http.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

function host(path = '/sync/run') {
  const response = {
    locals: {},
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn(),
  };
  const request = { path, method: 'POST' };
  const argumentsHost = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { response, argumentsHost };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('KbnHttpException: giữ mã HTTP, error_kbn, details; 429 thì đặt header Retry-After', () => {
    const { response, argumentsHost } = host();
    filter.catch(
      new KbnHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        60002,
        'SYNC_COOLDOWN',
        'chờ',
        { retryAfterSeconds: 90 },
      ),
      argumentsHost,
    );
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '90');
    expect(response.json.mock.calls[0][0]).toMatchObject({
      statusCode: 429,
      error: 'SYNC_COOLDOWN',
      errorKbn: 60002,
      message: 'chờ',
      details: { retryAfterSeconds: 90 },
      path: '/sync/run',
    });
  });

  it('ExternalApiError: đổi sang mã HTTP theo loại lỗi', () => {
    const { response, argumentsHost } = host('/bitrix/status');
    filter.catch(
      new ExternalApiError('bitrix24', 'AUTH', 'sai webhook'),
      argumentsHost,
    );
    expect(response.json.mock.calls[0][0]).toMatchObject({
      statusCode: 502,
      error: 'BITRIX24_AUTH',
      errorKbn: 40003,
    });
  });

  it('lỗi validate và lỗi lạ', () => {
    const a = host();
    filter.catch(
      new BadRequestException({ error: 'Validation Failed', message: ['x'] }),
      a.argumentsHost,
    );
    expect(a.response.json.mock.calls[0][0]).toMatchObject({
      statusCode: 400,
      errorKbn: 20001,
      message: ['x'],
    });
    const b = host('/health');
    filter.catch(new Error('boom'), b.argumentsHost);
    expect(b.response.json.mock.calls[0][0]).toMatchObject({
      statusCode: 500,
      errorKbn: 90001,
    });
    const c = host();
    filter.catch(new BadRequestException('chuỗi'), c.argumentsHost);
    expect(c.response.json.mock.calls[0][0]).toMatchObject({
      statusCode: 400,
      message: 'chuỗi',
    });
  });
});
