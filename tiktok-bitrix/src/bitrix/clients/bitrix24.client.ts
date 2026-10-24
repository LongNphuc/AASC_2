import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { ERROR, WARN } from '../../common/constants/messages.constant';
import { httpRequest } from '../../common/http/http-client';
import { errorKbnOf } from '../../common/kbn/error.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { REDIS } from '../../common/redis/redis.module';
import { take } from '../../common/redis/token-bucket';
import { appConfig, type AppConfig } from '../../config/app-config';
import { toBatchCommand } from '../mappers/batch-command.mapper';
import { fromErrorBody, toBitrixError } from '../mappers/bitrix-error.mapper';
import type {
  BatchCommand,
  BatchResult,
  BitrixErrorBody,
  BitrixResponse,
} from '../types/bitrix.types';

export const BATCH_LIMIT = 50;
/** Khóa limiter dùng chung cho mọi process (readme_improvements.md mục 3). */
export const BITRIX_RATE_KEY = 'ratelimit:bitrix24';
/** Lần gọi Bitrix24 thành công gần nhất, chế độ CRM: /health đọc (health/indicators). */
export const BITRIX_STATUS_KEY = 'bitrix:status';

interface BatchResponse {
  result: Record<string, unknown> | unknown[];
  result_error: Record<string, BitrixErrorBody> | unknown[];
}

/**
 * Mọi lệnh gọi Bitrix24 đi qua đây (readme_design.md mục 5.5):
 * - giới hạn tốc độ dùng chung qua Redis (BITRIX24_MAX_RPS, BITRIX24_BURST);
 * - timeout HTTP_TIMEOUT_MS; không thử lại bên trong lệnh gọi (thử lại ở tầng job);
 * - mọi lỗi đổi thành ExternalApiError → error_kbn 4xxxx;
 * - ghi mỗi lệnh gọi vào services/service_bitrix.log (URL webhook được che).
 */
@Injectable()
export class Bitrix24Client {
  private readonly logger = new ServiceLogger(
    LogService.BITRIX,
    Bitrix24Client.name,
  );

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async call<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const response = await this.post<T>(method, params);
    return response.result;
  }

  /**
   * Gửi tối đa 50 lệnh trong một request `batch` (halt=0: lệnh lỗi không chặn
   * lệnh khác). Trả kết quả riêng cho từng lệnh theo khóa.
   */
  async callBatch<T = unknown>(
    commands: Record<string, BatchCommand>,
  ): Promise<Record<string, BatchResult<T>>> {
    const keys = Object.keys(commands);
    if (keys.length > BATCH_LIMIT) {
      throw new Error(ERROR.BITRIX.BATCH_TOO_LARGE(keys.length));
    }
    if (keys.length === 0) return {};
    const cmd = Object.fromEntries(
      keys.map((key) => [key, toBatchCommand(commands[key])]),
    );
    const label = `batch[${keys.map((k) => commands[k].method).join(',')}]`;
    const response = await this.post<BatchResponse>(
      'batch',
      { halt: 0, cmd },
      label,
    );
    const results = asRecord(response.result.result);
    const errors = asRecord(response.result.result_error) as Record<
      string,
      BitrixErrorBody
    >;
    return Object.fromEntries(
      keys.map((key): [string, BatchResult<T>] =>
        key in errors
          ? [
              key,
              {
                ok: false,
                error: fromErrorBody(
                  undefined,
                  errors[key],
                  commands[key].method,
                ),
              },
            ]
          : [key, { ok: true, result: results[key] as T }],
      ),
    );
  }

  private async post<T>(
    method: string,
    body: Record<string, unknown>,
    label = method,
  ): Promise<BitrixResponse<T>> {
    await take(
      this.redis,
      BITRIX_RATE_KEY,
      this.config.bitrix.maxRps,
      this.config.bitrix.burst,
    );
    const startedAt = Date.now();
    try {
      const { status, body: data } = await httpRequest(
        'bitrix24',
        method,
        `${this.config.bitrix.webhookUrl}/${method}.json`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        this.config.httpTimeoutMs,
      );
      // Bitrix24 đôi khi trả HTTP 200 nhưng body báo lỗi.
      if (
        status >= 400 ||
        !data ||
        typeof data !== 'object' ||
        !('result' in data)
      ) {
        throw fromErrorBody(status, data, method);
      }
      this.logger.record({
        action: label,
        result: 'SUCCESS',
        durationMs: Date.now() - startedAt,
      });
      void this.redis
        .hset(BITRIX_STATUS_KEY, 'lastSuccessAt', Date.now())
        .catch(() => undefined);
      return data as BitrixResponse<T>;
    } catch (error) {
      const normalized = toBitrixError(error, method);
      this.logger.record({
        level: normalized.kind === 'NOT_FOUND' ? 'WARN' : 'ERROR',
        action: label,
        result: 'FAILED',
        errorKbn: errorKbnOf(normalized),
        durationMs: Date.now() - startedAt,
        detail: normalized.message,
      });
      if (normalized.kind !== 'NOT_FOUND') {
        this.logger.warn(
          WARN.EXTERNAL.CALL_FAILED(label, normalized.kind, normalized.message),
        );
      }
      throw normalized;
    }
  }
}

/** Bitrix24 trả `[]` thay vì `{}` khi không có phần tử nào. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
