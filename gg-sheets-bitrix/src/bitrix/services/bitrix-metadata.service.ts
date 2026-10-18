import { Injectable } from '@nestjs/common';
import { BitrixWebhookClient } from '../clients/bitrix-webhook.client';
import {
  BatchCommand,
  BitrixLeadField,
  BitrixStatus,
  BitrixUser,
  LeadMetadata,
} from '../types/bitrix.types';

const PAGE_SIZE = 50;

/**
 * Đọc định nghĩa trường lead, danh sách trạng thái và người dùng một lần ở
 * đầu mỗi lần chạy, để đổi giá trị trên Sheet sang mã Bitrix24 mà không phải
 * gọi API cho từng hàng.
 */
@Injectable()
export class BitrixMetadataService {
  constructor(private readonly bitrix: BitrixWebhookClient) {}

  async leadFields(): Promise<Record<string, BitrixLeadField>> {
    return this.bitrix.call<Record<string, BitrixLeadField>>('crm.lead.fields');
  }

  /**
   * @param usedFields mã các trường mapping dùng: chỉ đọc danh sách trạng thái
   * và người dùng khi có trường cần tới.
   */
  async loadForRun(usedFields: string[]): Promise<LeadMetadata> {
    const fields = await this.leadFields();
    const used = usedFields.map((code) => fields[code]).filter(Boolean);
    const statusTypes = [
      ...new Set(
        used
          .filter((f) => f.type === 'crm_status' && f.statusType)
          .map((f) => f.statusType!),
      ),
    ];
    const needUsers = used.some((f) => f.type === 'user');

    const commands: Record<string, BatchCommand> = {};
    for (const type of statusTypes) {
      commands[`status_${type}`] = {
        method: 'crm.status.list',
        params: { order: { SORT: 'ASC' }, filter: { ENTITY_ID: type } },
      };
    }
    const results = await this.bitrix.callBatch<BitrixStatus[]>(commands);
    const statuses: Record<string, BitrixStatus[]> = {};
    for (const type of statusTypes) {
      const result = results[`status_${type}`];
      if (!result.ok) throw result.error;
      statuses[type] = result.result;
    }
    return {
      fields,
      statuses,
      users: needUsers ? await this.activeUsers() : [],
    };
  }

  private async activeUsers(): Promise<BitrixUser[]> {
    const users: BitrixUser[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
      const page = await this.bitrix.callPage<BitrixUser>('user.get', {
        FILTER: { ACTIVE: true },
        start,
      });
      users.push(...page.result);
      if (page.next === undefined || page.result.length === 0) return users;
    }
  }
}
