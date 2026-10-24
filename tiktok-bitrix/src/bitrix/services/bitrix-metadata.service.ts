import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { ERROR } from '../../common/constants/messages.constant';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { externalErrorKbn } from '../../common/kbn/error.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { REDIS } from '../../common/redis/redis.module';
import { BITRIX_STATUS_KEY, Bitrix24Client } from '../clients/bitrix24.client';
import type { BitrixLeadField } from '../types/bitrix.types';

const LEAD_FIELDS_KEY = 'bitrix:lead-fields';
const LEAD_FIELDS_TTL_SECONDS = 600;

/** crm.settings.mode.get: 1 = cổ điển (có lead), 2 = đơn giản. */
const CRM_MODE_CLASSIC = 1;

export type CrmMode = 'classic' | 'simple';

/** Dữ liệu cấu trúc của portal: field lead, chế độ CRM (readme_design.md mục 5.1, 5.5). */
@Injectable()
export class BitrixMetadataService {
  private readonly logger = new ServiceLogger(
    LogService.BITRIX,
    BitrixMetadataService.name,
  );

  constructor(
    private readonly bitrix: Bitrix24Client,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Mã, tên, kiểu mọi field lead, kể cả custom field; cache Redis 10 phút. */
  async leadFields(): Promise<Record<string, BitrixLeadField>> {
    const cached = await this.redis.get(LEAD_FIELDS_KEY);
    if (cached) return JSON.parse(cached) as Record<string, BitrixLeadField>;
    const fields =
      await this.bitrix.call<Record<string, BitrixLeadField>>(
        'crm.lead.fields',
      );
    await this.redis.set(
      LEAD_FIELDS_KEY,
      JSON.stringify(fields),
      'EX',
      LEAD_FIELDS_TTL_SECONDS,
    );
    return fields;
  }

  async clearLeadFieldsCache(): Promise<void> {
    await this.redis.del(LEAD_FIELDS_KEY);
  }

  /**
   * Portal ở chế độ CRM đơn giản thì không có lead (Bitrix24 chuyển ngay thành
   * deal): ghi lỗi 40012, /health báo bitrix24 down. Kết quả lưu vào Redis cho
   * /health đọc.
   */
  async checkCrmMode(): Promise<CrmMode> {
    const value = await this.bitrix.call<number | string>(
      'crm.settings.mode.get',
    );
    const mode: CrmMode =
      Number(value) === CRM_MODE_CLASSIC ? 'classic' : 'simple';
    await this.redis.hset(BITRIX_STATUS_KEY, 'mode', mode);
    if (mode === 'simple') {
      const error = new ExternalApiError(
        'bitrix24',
        'CONFIG',
        ERROR.BITRIX.SIMPLE_MODE,
        { operation: 'crm.settings.mode.get' },
      );
      this.logger.error(
        `${externalErrorKbn('bitrix24', 'CONFIG')} ${error.message}`,
      );
    }
    return mode;
  }
}
