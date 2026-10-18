import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { WARN } from '../../common/constants/messages.constant';
import { RateLimiter } from '../../common/http/rate-limiter';
import { errorKbnOf } from '../../common/kbn/error.kbn';
import { StatusKbn } from '../../common/kbn/status.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import { fromErrorBody, toBitrixError } from '../mappers/bitrix-error.mapper';
import { BitrixResponse } from '../types/bitrix.types';

/**
 * Tầng HTTP thấp nhất để gọi Bitrix24 REST:
 * - giữ nhịp BITRIX24_MAX_RPS request/giây (tránh bị chặn ngay từ đầu);
 * - gửi một lần (thử lại do lớp gọi quyết định, vì có lệnh không được thử lại);
 * - chuẩn hóa mọi lỗi thành ExternalApiError;
 * - ghi mỗi lệnh gọi vào services/service_bitrix.log (URL webhook được che).
 */
@Injectable()
export class BitrixHttpClient {
  private readonly logger = new ServiceLogger(
    LogService.BITRIX,
    BitrixHttpClient.name,
  );
  private readonly limiter: RateLimiter;

  constructor(
    private readonly http: HttpService,
    @Inject(appConfig.KEY) config: AppConfig,
  ) {
    this.limiter = new RateLimiter(config.bitrix.maxRps);
  }

  async post<T>(
    url: string,
    body: Record<string, unknown>,
    operation: string,
  ): Promise<BitrixResponse<T>> {
    await this.limiter.acquire();
    const startedAt = Date.now();
    try {
      const response = await firstValueFrom(
        this.http.post<BitrixResponse<T>>(url, body),
      );
      const data: unknown = response.data;
      // Bitrix24 đôi khi trả HTTP 200 nhưng body báo lỗi.
      if (!data || typeof data !== 'object' || !('result' in data)) {
        throw fromErrorBody(response.status, data, operation);
      }
      this.logger.record({
        method: operation,
        statusKbn: StatusKbn.SUCCESS,
        durationMs: Date.now() - startedAt,
      });
      return data as BitrixResponse<T>;
    } catch (error) {
      const normalized = toBitrixError(error, operation);
      this.logger.record({
        method: operation,
        statusKbn: StatusKbn.FAILED,
        errorKbn: errorKbnOf(normalized),
        durationMs: Date.now() - startedAt,
        errorDetail: normalized.message,
      });
      this.logger.warn(
        WARN.EXTERNAL.CALL_FAILED(
          operation,
          normalized.kind,
          normalized.message,
        ),
      );
      throw normalized;
    }
  }
}
