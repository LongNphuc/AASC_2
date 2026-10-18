import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ExternalApiError } from '../errors/external-api.error';
import { KbnError } from '../errors/kbn-http.exception';
import {
  describeErrorKbn,
  ErrorKbn,
  errorKbnOf,
  externalErrorKbn,
} from './error.kbn';

describe('error.kbn', () => {
  it('mã lỗi dịch vụ ngoài = nguồn × 10000 + loại', () => {
    expect(externalErrorKbn('bitrix24', 'RATE_LIMIT')).toBe(40009);
    expect(externalErrorKbn('google-sheets', 'SHEET_NOT_FOUND')).toBe(30014);
    expect(externalErrorKbn('google-auth', 'RECONNECT_REQUIRED')).toBe(50005);
  });

  it('suy mã lỗi từ mọi loại lỗi', () => {
    expect(
      errorKbnOf(new ExternalApiError('bitrix24', 'OPERATION_LIMIT', 'x')),
    ).toBe(40013);
    expect(errorKbnOf(new KbnError(60003, 'hết giờ'))).toBe(60003);
    expect(errorKbnOf(new ForbiddenException())).toBe(ErrorKbn.UNAUTHORIZED);
    expect(errorKbnOf(new NotFoundException())).toBe(ErrorKbn.NOT_FOUND);
    expect(errorKbnOf(new BadRequestException())).toBe(ErrorKbn.VALIDATION);
    expect(errorKbnOf(new Error('?'))).toBe(ErrorKbn.UNKNOWN);
  });

  it('tên dễ đọc cho log', () => {
    expect(describeErrorKbn(40009)).toBe('BITRIX24.RATE_LIMIT');
    expect(describeErrorKbn(60001)).toBe('SYNC.BUSY');
    expect(describeErrorKbn(20005)).toBe('REQUEST.HEADER_MISSING');
  });
});
