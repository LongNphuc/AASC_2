import { Inject, Injectable } from '@nestjs/common';
import { ERROR, WARN } from '../../common/constants/messages.constant';
import {
  ExternalApiError,
  type ExternalErrorKind,
} from '../../common/errors/external-api.error';
import { httpRequest } from '../../common/http/http-client';
import { errorKbnOf } from '../../common/kbn/error.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';

const OPERATION = 'event/track';

interface TiktokResponse {
  code?: number;
  message?: string;
  request_id?: string;
}

/** Mã lỗi TikTok Business API (HTTP 200 kèm code khác 0) → loại lỗi. */
export function classifyTiktokCode(code: number): ExternalErrorKind {
  if (code === 40100 || code === 40016) return 'RATE_LIMIT';
  if ([40001, 40104, 40105, 40102].includes(code)) return 'AUTH';
  if (code >= 50000) return 'SERVER';
  return 'BAD_REQUEST';
}

/**
 * TikTok Events API: POST {TIKTOK_API_BASE_URL}/open_api/v1.3/event/track/
 * với header Access-Token (readme_design.md mục 8). Lỗi đổi thành error_kbn
 * 3xxxx; ghi mỗi lệnh gọi vào services/service_tiktok.log.
 */
@Injectable()
export class TiktokEventsClient {
  private readonly logger = new ServiceLogger(
    LogService.TIKTOK,
    TiktokEventsClient.name,
  );

  constructor(@Inject(appConfig.KEY) private readonly config: AppConfig) {}

  async track(body: Record<string, unknown>): Promise<{ requestId?: string }> {
    const { accessToken, crmEventSetId, apiBaseUrl } = this.config.tiktok;
    const startedAt = Date.now();
    try {
      if (!accessToken || !crmEventSetId) {
        throw new ExternalApiError(
          'tiktok',
          'CONFIG',
          ERROR.TIKTOK.NOT_CONFIGURED,
          {
            operation: OPERATION,
          },
        );
      }
      const { status, body: data } = await httpRequest(
        'tiktok',
        OPERATION,
        `${apiBaseUrl}/open_api/v1.3/event/track/`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Access-Token': accessToken,
          },
          body: JSON.stringify(body),
        },
        this.config.httpTimeoutMs,
      );
      const response = (data ?? {}) as TiktokResponse;
      if (status >= 500) throw this.error('SERVER', `HTTP ${status}`, status);
      if (status >= 400 || response.code === undefined) {
        throw this.error(
          status === 429 ? 'RATE_LIMIT' : 'INVALID_RESPONSE',
          `HTTP ${status}`,
          status,
        );
      }
      if (response.code !== 0) {
        throw this.error(
          classifyTiktokCode(response.code),
          `${response.code} ${response.message ?? ''}`,
          status,
          response.code,
        );
      }
      this.logger.record({
        action: OPERATION,
        result: 'SUCCESS',
        durationMs: Date.now() - startedAt,
      });
      return { requestId: response.request_id };
    } catch (error) {
      const normalized =
        error instanceof ExternalApiError
          ? error
          : new ExternalApiError('tiktok', 'INVALID_RESPONSE', String(error), {
              operation: OPERATION,
            });
      this.logger.record({
        action: OPERATION,
        result: 'FAILED',
        errorKbn: errorKbnOf(normalized),
        durationMs: Date.now() - startedAt,
        detail: normalized.message,
      });
      this.logger.warn(
        WARN.EXTERNAL.CALL_FAILED(
          OPERATION,
          normalized.kind,
          normalized.message,
        ),
      );
      throw normalized;
    }
  }

  private error(
    kind: ExternalErrorKind,
    reason: string,
    status?: number,
    code?: number,
  ) {
    return new ExternalApiError(
      'tiktok',
      kind,
      ERROR.TIKTOK.REQUEST_FAILED(kind, OPERATION, reason),
      {
        operation: OPERATION,
        upstreamStatus: status,
        upstreamCode: code !== undefined ? String(code) : undefined,
      },
    );
  }
}
