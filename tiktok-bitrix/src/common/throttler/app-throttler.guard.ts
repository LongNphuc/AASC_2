import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { appConfig, type AppConfig } from '../../config/app-config';
import { API_KEY_HEADER } from '../auth/api-key.guard';
import { safeEquals } from '../auth/safe-equals';
import { ERROR } from '../constants/messages.constant';
import { KbnHttpException } from '../errors/kbn-http.exception';
import { ErrorKbn } from '../kbn/error.kbn';

/** Tên các nhóm giới hạn tốc độ (readme_design.md mục 16). */
export const THROTTLER = {
  API: 'api',
  EXPORT: 'export',
  WEBHOOK: 'webhook',
} as const;

const EXPORT_PATH = '/api/v1/reports/export';

/** Nhóm nào áp cho đường dẫn nào; nhóm không áp thì bỏ qua. */
export function throttlerApplies(name: string, path: string): boolean {
  switch (name) {
    case THROTTLER.API:
      return path.startsWith('/api/v1/');
    case THROTTLER.EXPORT:
      return path === EXPORT_PATH;
    case THROTTLER.WEBHOOK:
      return path.startsWith('/webhooks/');
    default:
      return false;
  }
}

/**
 * Giới hạn tốc độ theo API key đúng (không có hoặc sai thì theo IP), bộ đếm
 * chung cho mọi endpoint của nhóm và mọi instance api (lưu trong Redis). Vượt
 * thì 429 với errorKbn 20016 và header Retry-After.
 *
 * Guard này chạy trước ApiKeyGuard, nên phải tự so key: tính theo key chưa
 * xác thực thì đổi key giả mỗi request là né được giới hạn theo IP.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {
    super(options, storage, reflector);
  }

  protected async getTracker(req: Request): Promise<string> {
    const apiKey = req.header(API_KEY_HEADER);
    if (
      apiKey &&
      this.config.apiKey &&
      safeEquals(apiKey, this.config.apiKey)
    ) {
      return `key:${createHash('sha256').update(apiKey).digest('hex').slice(0, 16)}`;
    }
    return `ip:${await super.getTracker(req)}`;
  }

  protected generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return `${name}:${tracker}`;
  }

  protected throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const seconds = Math.max(1, detail.timeToBlockExpire);
    throw new KbnHttpException(
      429,
      ErrorKbn.TOO_MANY_REQUESTS,
      ERROR.LABEL.TOO_MANY_REQUESTS,
      ERROR.THROTTLE.TOO_MANY(seconds),
      { retryAfterSeconds: seconds },
    );
  }
}
