import { Injectable } from '@nestjs/common';
import {
  BATCH_LIMIT,
  BitrixWebhookClient,
} from '../../bitrix/clients/bitrix-webhook.client';
import type { BatchCommand } from '../../bitrix/types/bitrix.types';
import { WARN } from '../../common/constants/messages.constant';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { toNationalPhone } from '../../mapping/transformers/phone.transformer';
import type { ExistingLeads } from '../mappers/lead-group.mapper';
import type { RunControl } from '../types/lead.types';

interface Lookup {
  kind: 'email' | 'phone';
  value: string;
}

/**
 * Tra trùng trên Bitrix24 cho các hàng chưa có Lead ID, bằng crm.lead.list
 * lọc theo EMAIL và PHONE (đề chỉ định), gom tối đa 50 lệnh trong một batch.
 * SĐT tra cả dạng +84… lẫn 0…, vì lead nhập tay có thể lưu một trong hai.
 * Nhiều lead khớp thì chọn lead cũ nhất (ID nhỏ nhất).
 */
@Injectable()
export class LeadDedupeService {
  private readonly logger = new ServiceLogger(
    LogService.SYNC,
    LeadDedupeService.name,
  );

  constructor(private readonly bitrix: BitrixWebhookClient) {}

  async findExisting(
    emails: string[],
    phones: string[],
    control: RunControl,
  ): Promise<ExistingLeads> {
    const lookups = new Map<string, Lookup>();
    const commands: [string, BatchCommand][] = [];
    [...new Set(emails)].forEach((email, i) => {
      lookups.set(`e${i}`, { kind: 'email', value: email });
      commands.push([`e${i}`, listBy('EMAIL', email)]);
    });
    [...new Set(phones)].forEach((phone, i) => {
      for (const [suffix, variant] of [
        ['a', phone],
        ['b', toNationalPhone(phone)],
      ] as const) {
        lookups.set(`p${i}${suffix}`, { kind: 'phone', value: phone });
        commands.push([`p${i}${suffix}`, listBy('PHONE', variant)]);
      }
    });

    const existing: ExistingLeads = { byEmail: new Map(), byPhone: new Map() };
    for (let start = 0; start < commands.length; start += BATCH_LIMIT) {
      const stop = control.stopReason();
      if (stop) throw stop;
      const chunk = Object.fromEntries(
        commands.slice(start, start + BATCH_LIMIT),
      );
      const results = await this.bitrix.callBatch<{ ID: string }[]>(chunk, {
        canWait: (ms) => control.canWait(ms),
      });
      for (const [key, result] of Object.entries(results)) {
        if (!result.ok) throw result.error;
        const ids = result.result
          .map((lead) => Number(lead.ID))
          .filter(Number.isFinite);
        if (ids.length === 0) continue;
        const { kind, value } = lookups.get(key)!;
        const target = kind === 'email' ? existing.byEmail : existing.byPhone;
        const best = Math.min(...ids, target.get(value) ?? Infinity);
        if (ids.length > 1)
          this.logger.warn(WARN.SYNC.MULTIPLE_LEADS(value, ids.join(', ')));
        target.set(value, best);
      }
    }
    return existing;
  }
}

function listBy(field: 'EMAIL' | 'PHONE', value: string): BatchCommand {
  return {
    method: 'crm.lead.list',
    params: {
      filter: { [field]: value },
      select: ['ID'],
      order: { ID: 'ASC' },
    },
  };
}
