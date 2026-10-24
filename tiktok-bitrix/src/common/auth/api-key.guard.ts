import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { appConfig, type AppConfig } from '../../config/app-config';
import { ERROR } from '../constants/messages.constant';
import { KbnHttpException } from '../errors/kbn-http.exception';
import { ErrorKbn } from '../kbn/error.kbn';
import { IS_PUBLIC_KEY } from './public.decorator';
import { safeEquals } from './safe-equals';

export const API_KEY_HEADER = 'x-api-key';

/**
 * Guard toàn cục, bật khi có API_KEY trong .env: mọi endpoint đều cần header
 * `x-api-key` đúng với API_KEY, trừ endpoint gắn @Public(). Bảo vệ mặc định
 * giúp endpoint mới thêm vào không bị lộ do quên gắn guard.
 *
 * API_KEY để trống (chạy local, demo): không bảo vệ, log khởi động có cảnh báo.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || !this.config.apiKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header(API_KEY_HEADER);
    if (!provided || !safeEquals(provided, this.config.apiKey)) {
      throw new KbnHttpException(
        401,
        ErrorKbn.UNAUTHORIZED,
        'UNAUTHORIZED',
        ERROR.AUTH.API_KEY_INVALID(API_KEY_HEADER),
      );
    }
    return true;
  }
}
