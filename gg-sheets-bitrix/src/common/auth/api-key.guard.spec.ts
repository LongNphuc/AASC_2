import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppConfig } from '../../config/app-config';
import { ApiKeyGuard } from './api-key.guard';

function context(header?: string): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ header: () => header }) }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;

  it('đúng key thì cho qua; thiếu hoặc sai thì 401', () => {
    const guard = new ApiKeyGuard(reflector, { apiKey: 'k' } as AppConfig);
    expect(guard.canActivate(context('k'))).toBe(true);
    expect(() => guard.canActivate(context('sai'))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(context())).toThrow(UnauthorizedException);
  });

  it('API_KEY trống thì không bảo vệ (chạy local); endpoint @Public thì luôn qua', () => {
    const open = new ApiKeyGuard(reflector, { apiKey: '' } as AppConfig);
    expect(open.canActivate(context())).toBe(true);
    expect(open.canActivate(context('bất kỳ'))).toBe(true);
    const publicReflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    expect(
      new ApiKeyGuard(publicReflector, {} as AppConfig).canActivate(context()),
    ).toBe(true);
  });
});
