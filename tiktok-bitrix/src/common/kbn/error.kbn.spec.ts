import {
  BadRequestException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ExternalApiError } from '../errors/external-api.error';
import { KbnError } from '../errors/kbn-http.exception';
import {
  describeErrorKbn,
  ErrorKbn,
  errorKbnOf,
  externalErrorKbn,
  isTransientDbError,
  isTransientErrorKbn,
  isTransientRedisError,
  kbnFromFailedReason,
  transientErrorKbns,
} from './error.kbn';

describe('error.kbn', () => {
  it('ghép mã lỗi dịch vụ ngoài: chữ số đầu là nơi lỗi', () => {
    expect(externalErrorKbn('bitrix24', 'RATE_LIMIT')).toBe(40009);
    expect(externalErrorKbn('tiktok', 'AUTH')).toBe(30003);
    expect(errorKbnOf(new ExternalApiError('bitrix24', 'NOT_FOUND', 'x'))).toBe(
      40007,
    );
  });

  it('suy mã từ lỗi mang sẵn errorKbn, HttpException, message của job và lỗi DB', () => {
    expect(errorKbnOf(new KbnError(ErrorKbn.DEAL_ALREADY_OPEN, 'x'))).toBe(
      20013,
    );
    expect(errorKbnOf(new UnauthorizedException())).toBe(ErrorKbn.UNAUTHORIZED);
    expect(errorKbnOf(new NotFoundException())).toBe(ErrorKbn.NOT_FOUND);
    expect(errorKbnOf(new HttpException('x', 429))).toBe(
      ErrorKbn.TOO_MANY_REQUESTS,
    );
    expect(errorKbnOf(new BadRequestException())).toBe(ErrorKbn.VALIDATION);
    expect(errorKbnOf(new Error('40010 BITRIX24.SERVER: lỗi'))).toBe(40010);
    expect(
      errorKbnOf(
        Object.assign(new Error('mất kết nối'), { code: 'ECONNREFUSED' }),
      ),
    ).toBe(ErrorKbn.DB_TRANSIENT);
    expect(errorKbnOf(new Error('khác'))).toBe(ErrorKbn.UNKNOWN);
    expect(errorKbnOf('chuỗi')).toBe(ErrorKbn.UNKNOWN);
  });

  it('phân biệt lỗi tạm thời theo bảng của readme_design.md mục 12.2', () => {
    for (const code of [
      30001, 30002, 30009, 30010, 40001, 40002, 40009, 40010, 40013, 90003,
    ]) {
      expect(isTransientErrorKbn(code)).toBe(true);
    }
    expect(isTransientErrorKbn(40003)).toBe(false);
    expect(isTransientErrorKbn(null)).toBe(false);
    expect(transientErrorKbns()).toContain(40009);
  });

  it('đọc tên mã lỗi và mã ở đầu lý do lỗi của job', () => {
    expect(describeErrorKbn(40009)).toBe('BITRIX24.RATE_LIMIT');
    expect(describeErrorKbn(20013)).toBe('REQUEST.DEAL_ALREADY_OPEN');
    expect(describeErrorKbn(12345)).toBe('UNKNOWN_SOURCE.12345');
    expect(kbnFromFailedReason('40009 BITRIX24.RATE_LIMIT: …')).toBe(40009);
    expect(kbnFromFailedReason('lỗi lạ')).toBeUndefined();
    expect(kbnFromFailedReason(null)).toBeUndefined();
  });

  it('nhận lỗi DB tạm thời theo mã của driver', () => {
    expect(isTransientDbError({ driverError: { code: '57P01' } })).toBe(true);
    expect(isTransientDbError({ code: '40P01' })).toBe(true);
    expect(isTransientDbError({ code: '23505' })).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });

  it('nhận lỗi ioredis khi Redis sập hoặc chập chờn: 90004, là lỗi tạm thời', () => {
    const maxRetries = Object.assign(
      new Error('Reached the max retries per request limit (which is 1).'),
      {
        name: 'MaxRetriesPerRequestError',
      },
    );
    for (const error of [
      maxRetries,
      new Error(
        "Stream isn't writeable and enableOfflineQueue options is false",
      ),
      new Error('Connection is closed.'),
    ]) {
      expect(isTransientRedisError(error)).toBe(true);
      expect(errorKbnOf(error)).toBe(ErrorKbn.REDIS_TRANSIENT);
    }
    expect(isTransientErrorKbn(ErrorKbn.REDIS_TRANSIENT)).toBe(true);
    expect(describeErrorKbn(ErrorKbn.REDIS_TRANSIENT)).toBe(
      'SYSTEM.REDIS_TRANSIENT',
    );
    expect(
      isTransientRedisError(new Error('WRONGTYPE Operation against a key')),
    ).toBe(false);
    expect(isTransientRedisError(undefined)).toBe(false);
  });
});
