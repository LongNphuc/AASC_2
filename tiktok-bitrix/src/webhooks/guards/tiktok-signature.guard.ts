import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ERROR, WARN } from '../../common/constants/messages.constant';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import {
  TIKTOK_SIGNATURE_HEADER,
  verifyTiktokSignature,
} from '../helpers/tiktok-signature';

/**
 * Kiểm TikTok-Signature trên raw body (api.module.ts chỉ đọc body dạng Buffer
 * cho đường dẫn này). Sai thì 401 và không lưu gì: tránh để request giả làm
 * đầy DB, chỉ ghi log (readme_design.md mục 3.2).
 */
@Injectable()
export class TikTokSignatureGuard implements CanActivate {
  private readonly logger = new ServiceLogger(
    LogService.WEBHOOK,
    TikTokSignatureGuard.name,
  );

  constructor(@Inject(appConfig.KEY) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const rawBody = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.alloc(0);
    const check = verifyTiktokSignature(
      request.header(TIKTOK_SIGNATURE_HEADER),
      rawBody,
      this.config.tiktok.webhookSecret,
      this.config.tiktok.signatureToleranceSeconds,
    );
    if (check.ok) return true;

    this.logger.warn(WARN.WEBHOOK.SIGNATURE(check.reason));
    if (check.reason === 'expired') {
      throw new KbnHttpException(
        401,
        ErrorKbn.SIGNATURE_EXPIRED,
        ERROR.LABEL.SIGNATURE_EXPIRED,
        ERROR.WEBHOOK.SIGNATURE_EXPIRED(
          check.skew ?? 0,
          this.config.tiktok.signatureToleranceSeconds,
        ),
      );
    }
    const message = {
      missing: ERROR.WEBHOOK.SIGNATURE_MISSING,
      format: ERROR.WEBHOOK.SIGNATURE_FORMAT,
      mismatch: ERROR.WEBHOOK.SIGNATURE_MISMATCH,
    }[check.reason];
    throw new KbnHttpException(
      401,
      ErrorKbn.SIGNATURE_INVALID,
      ERROR.LABEL.SIGNATURE_INVALID,
      message,
    );
  }
}
