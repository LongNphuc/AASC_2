import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { safeEquals } from '../../common/auth/safe-equals';
import { ERROR, WARN } from '../../common/constants/messages.constant';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';

/**
 * Bitrix24 gửi kèm auth[application_token] trong mỗi webhook đi: so với
 * BITRIX24_OUTBOUND_TOKEN trong thời gian không đổi (readme_design.md mục 7).
 */
@Injectable()
export class BitrixTokenGuard implements CanActivate {
  private readonly logger = new ServiceLogger(
    LogService.WEBHOOK,
    BitrixTokenGuard.name,
  );

  constructor(@Inject(appConfig.KEY) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.bitrix.outboundToken;
    if (!expected) {
      throw new KbnHttpException(
        503,
        ErrorKbn.CONFIG,
        ERROR.LABEL.NOT_CONFIGURED,
        ERROR.WEBHOOK.BITRIX_TOKEN_NOT_SET,
      );
    }
    const body = context.switchToHttp().getRequest<Request>().body as {
      auth?: { application_token?: unknown };
    };
    const token = body?.auth?.application_token;
    if (typeof token !== 'string' || !safeEquals(token, expected)) {
      this.logger.warn(WARN.WEBHOOK.BITRIX_TOKEN);
      throw new KbnHttpException(
        401,
        ErrorKbn.BITRIX_TOKEN_INVALID,
        ERROR.LABEL.BITRIX_TOKEN_INVALID,
        ERROR.WEBHOOK.BITRIX_TOKEN_INVALID,
      );
    }
    return true;
  }
}
