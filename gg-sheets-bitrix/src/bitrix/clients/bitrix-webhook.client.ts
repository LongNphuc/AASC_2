import { Inject, Injectable } from '@nestjs/common';
import { ERROR, WARN } from '../../common/constants/messages.constant';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { RetryOptions, withRetry } from '../../common/http/retry';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import { toBatchCommand } from '../mappers/batch-command.mapper';
import { fromErrorBody } from '../mappers/bitrix-error.mapper';
import {
  BatchCommand,
  BatchResult,
  BitrixErrorBody,
} from '../types/bitrix.types';
import { BitrixHttpClient } from './bitrix-http.client';

export const BATCH_LIMIT = 50;

interface BatchResponse {
  result: Record<string, unknown> | unknown[];
  result_error: Record<string, BitrixErrorBody> | unknown[];
  result_total?: Record<string, number> | unknown[];
}

/** Tùy chọn thử lại cho một lệnh gọi. */
export type CallOptions = Pick<RetryOptions, 'isRetryable' | 'canWait'>;

/**
 * Gọi Bitrix24 qua webhook vào (BITRIX24_WEBHOOK_URL): một URL cố định chứa sẵn
 * mã xác thực. Lỗi tạm thời được thử lại theo backoff (RETRY_*); lớp gọi có
 * thể tắt thử lại cho lệnh không an toàn (ví dụ tạo lead bị timeout).
 */
@Injectable()
export class BitrixWebhookClient {
  private readonly logger = new ServiceLogger(
    LogService.BITRIX,
    BitrixWebhookClient.name,
  );

  constructor(
    private readonly http: BitrixHttpClient,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async call<T>(
    method: string,
    params: Record<string, unknown> = {},
    options: CallOptions = {},
  ): Promise<T> {
    const response = await this.post<T>(method, params, options);
    return response.result;
  }

  /** Như call nhưng trả cả `total`, `next` (cho method *.list có phân trang). */
  async callPage<T>(
    method: string,
    params: Record<string, unknown> = {},
    options: CallOptions = {},
  ) {
    return this.post<T[]>(method, params, options);
  }

  /**
   * Gửi tối đa 50 lệnh trong một request `batch` (halt=0: lệnh lỗi không chặn
   * lệnh khác). Trả kết quả riêng cho từng lệnh theo khóa.
   */
  async callBatch<T = unknown>(
    commands: Record<string, BatchCommand>,
    options: CallOptions = {},
  ): Promise<Record<string, BatchResult<T>>> {
    const keys = Object.keys(commands);
    if (keys.length > BATCH_LIMIT) {
      throw new Error(ERROR.BITRIX.BATCH_TOO_LARGE(keys.length));
    }
    if (keys.length === 0) return {};
    const cmd = Object.fromEntries(
      keys.map((key) => [key, toBatchCommand(commands[key])]),
    );
    const response = await this.post<BatchResponse>(
      'batch',
      { halt: 0, cmd },
      options,
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
    params: Record<string, unknown>,
    options: CallOptions,
  ) {
    const baseUrl = this.config.bitrix.webhookUrl;
    if (!baseUrl) {
      throw new ExternalApiError(
        'bitrix24',
        'CONFIG',
        ERROR.BITRIX.WEBHOOK_NOT_CONFIGURED,
        { operation: method },
      );
    }
    try {
      return await withRetry(
        () => this.http.post<T>(`${baseUrl}/${method}.json`, params, method),
        this.config.retry,
        {
          ...options,
          onRetry: (_error, attempt, delayMs) =>
            this.logger.warn(WARN.EXTERNAL.RETRY(method, attempt, delayMs)),
        },
      );
    } catch (error) {
      if (error instanceof ExternalApiError && error.kind === 'AUTH') {
        throw new ExternalApiError(
          error.service,
          error.kind,
          ERROR.BITRIX.WEBHOOK_AUTH_HINT(error.message),
          error.details,
        );
      }
      throw error;
    }
  }
}

/** Bitrix24 trả `[]` thay vì `{}` khi không có phần tử nào. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
