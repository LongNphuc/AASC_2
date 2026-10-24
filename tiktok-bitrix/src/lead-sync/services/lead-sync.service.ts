import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { jsonValue } from '../../database/json';
import { Bitrix24Client } from '../../bitrix/clients/bitrix24.client';
import { isNotFound } from '../../bitrix/mappers/bitrix-error.mapper';
import { BitrixMetadataService } from '../../bitrix/services/bitrix-metadata.service';
import {
  ENTITY_TYPE,
  ORIGINATOR_ID,
  type BitrixItem,
  type BitrixLead,
} from '../../bitrix/types/bitrix.types';
import { LOG, MSG } from '../../common/constants/messages.constant';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { LeadStatusKbn } from '../../common/kbn/status.kbn';
import { BitrixActionKbn } from '../../common/kbn/type.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { ConfigurationService } from '../../configurations/services/configuration.service';
import {
  CONFIG_KEY,
  type FieldMapping,
} from '../../configurations/types/configuration.types';
import { Lead } from '../../leads/entities/lead.entity';
import {
  LeadSubmission,
  type SubmissionWarning,
} from '../../leads/entities/lead-submission.entity';
import {
  warning,
  WARNING,
} from '../../leads/services/lead-event-normalizer.service';
import type { JobContext } from '../../pipeline/jobs/job-context';
import type { StepOutcome } from '../../pipeline/jobs/step.types';
import type { MultiFieldValue } from '../transformers/field-value.transformer';
import { duplicateIds, pickCrmRecord } from './bitrix-lead-matcher';
import { buildCustomerView } from './customer-view.builder';
import { CREATE_ONLY_FIELDS, FieldMapperService } from './field-mapper.service';
import { mergeContactFm, newLeadValues } from './multifield-diff';
import { hashFields, stableStringify } from './sync-hash';

interface LeadHistory {
  first: LeadSubmission;
  latest: LeadSubmission;
  /** Các kênh khách đã đến, theo lần đầu xuất hiện (UF_CRM_SOURCES, mục 5.6). */
  channels: number[];
}

/** Kết quả tra lead trên CRM khi khách chưa có bitrix24_id. */
interface CrmLookup {
  byOrigin: number | null;
  chosen: number | null;
  excluded: number[];
  excludedBy: string;
}

/**
 * Bước 3 của job tiktok-event: đồng bộ khách lên Bitrix24 (readme_design.md
 * mục 5.2, 5.3). Trước mọi lệnh tạo, cập nhật đều có lệnh đọc (mục 5.5): đã
 * có thì dùng lại, đã đúng thì không gửi, không còn trên CRM thì đi nhánh khác.
 */
@Injectable()
export class LeadSyncService {
  private readonly logger = new ServiceLogger(
    LogService.LEAD,
    LeadSyncService.name,
  );

  constructor(
    private readonly bitrix: Bitrix24Client,
    private readonly metadata: BitrixMetadataService,
    private readonly configs: ConfigurationService,
    private readonly mapper: FieldMapperService,
  ) {}

  /** Bước 3a: lead của khách. */
  async syncLead(ctx: JobContext): Promise<StepOutcome> {
    const submission = await ctx.requireSubmission();
    const lead = await ctx.lead(submission.leadUuid);
    const history = await this.history(ctx.db, lead.uuid);
    const mapping = (
      await this.configs.get<FieldMapping>(CONFIG_KEY.FIELD_MAPPING)
    ).value;
    const leadFields = await this.metadata.leadFields();
    const fields = {
      ...this.mapper.map(
        buildCustomerView(lead, history.latest),
        mapping,
        leadFields,
      ),
      ...this.mapper.autoFields({ lead, ...history }),
    };
    const hash = hashFields(fields);
    const warnings: SubmissionWarning[] = [];

    let bitrixId: number | null = null;
    let action: BitrixActionKbn;
    const current = lead.bitrix24Id
      ? await this.getLead(lead.bitrix24Id)
      : null;
    if (lead.bitrix24Id && !current) {
      // Sales xóa hoặc gộp lead trên CRM: tra lại theo email/SĐT.
      warnings.push(
        warning(WARNING.LEAD_GONE, MSG.WARNING.LEAD_GONE(lead.bitrix24Id)),
      );
    }

    if (current) {
      bitrixId = lead.bitrix24Id;
      if (hash === lead.bitrixSyncHash) {
        action = BitrixActionKbn.UNCHANGED;
      } else {
        await this.updateLead(
          current,
          fields,
          lead.bitrixSyncedFields,
          warnings,
        );
        action = BitrixActionKbn.UPDATED;
      }
    } else {
      const found = await this.lookup(ctx.db, lead);
      const linkId = found.byOrigin ?? found.chosen;
      if (linkId) {
        // byOrigin: lead do chính ứng dụng tạo ở lần chạy trước mà chưa kịp lưu ID.
        const linked = await this.getLead(linkId);
        if (!linked) throw new Error(`Lead #${linkId} vừa biến mất trên CRM`);
        await this.updateLead(linked, fields, null, warnings);
        bitrixId = linkId;
        action = BitrixActionKbn.LINKED;
      } else {
        bitrixId = Number(
          await this.bitrix.call<number>('crm.lead.add', {
            fields,
            params: { REGISTER_SONET_EVENT: 'Y' },
          }),
        );
        action = BitrixActionKbn.CREATED;
        if (found.excluded.length) {
          warnings.push(
            warning(
              WARNING.DUPLICATE_SUSPECT,
              MSG.WARNING.DUPLICATE_SUSPECT(found.excluded, found.excludedBy),
            ),
          );
        }
      }
    }
    this.logger.log(LOG.LEAD.SYNCED(BitrixActionKbn[action], bitrixId!));
    // Khách chuyển sang bản ghi lead khác trên CRM (lead cũ bị xóa, gộp):
    // CONVERTED là trạng thái của lead cũ, đặt lại IN_CRM để bước 6c chuyển
    // lead mới khi khách có deal.
    const relinked = lead.bitrix24Id !== null && bitrixId !== lead.bitrix24Id;

    return {
      commit: async (manager) => {
        await manager.update(
          Lead,
          { uuid: lead.uuid },
          {
            bitrix24Id: bitrixId,
            bitrixSyncHash: hash,
            bitrixSyncedFields: jsonValue(fields),
            bitrixSyncedAt: new Date(),
            statusKbn:
              lead.statusKbn === LeadStatusKbn.NEW || relinked
                ? LeadStatusKbn.IN_CRM
                : lead.statusKbn,
            updatedAt: new Date(),
          },
        );
        await manager.update(
          LeadSubmission,
          { uuid: submission.uuid },
          {
            bitrixActionKbn: action,
            warnings: [...submission.warnings, ...warnings],
            updatedAt: new Date(),
          },
        );
      },
    };
  }

  /**
   * Bước 3b: Contact của khách (chỉ khi khách đã có Contact, mục 6.2). Tên,
   * email, SĐT đổi thì đọc Contact, cập nhật tên và chỉ thêm email/SĐT chưa có.
   */
  async syncContact(ctx: JobContext): Promise<StepOutcome> {
    const submission = await ctx.requireSubmission();
    const lead = await ctx.lead(submission.leadUuid);
    if (!lead.bitrixContactId) return {};
    const contactHash = contactHashOf(lead);
    if (contactHash === lead.bitrixContactHash) return {};

    const contact = await this.getItem(
      ENTITY_TYPE.CONTACT,
      lead.bitrixContactId,
    );
    if (!contact) {
      const gone = warning(
        WARNING.CONTACT_GONE,
        MSG.WARNING.CONTACT_GONE(lead.bitrixContactId),
      );
      return {
        commit: async (manager) => {
          await manager.update(
            Lead,
            { uuid: lead.uuid },
            {
              bitrixContactId: null,
              bitrixContactHash: null,
              updatedAt: new Date(),
            },
          );
          await manager.update(
            LeadSubmission,
            { uuid: submission.uuid },
            {
              warnings: [...submission.warnings, gone],
              updatedAt: new Date(),
            },
          );
        },
      };
    }
    const changes: Record<string, unknown> = {};
    if (contact.name !== lead.name) changes.name = lead.name;
    const fm = mergeContactFm(contact.fm, contactValues(lead));
    if (fm) changes.fm = fm;
    if (Object.keys(changes).length) {
      await this.bitrix.call('crm.item.update', {
        entityTypeId: ENTITY_TYPE.CONTACT,
        id: lead.bitrixContactId,
        fields: changes,
      });
    }
    return {
      commit: async (manager) => {
        await manager.update(
          Lead,
          { uuid: lead.uuid },
          {
            bitrixContactHash: contactHash,
            updatedAt: new Date(),
          },
        );
      },
    };
  }

  /**
   * Cập nhật lead đã có (mục 5.3): chỉ gửi field khác lần đồng bộ thành công
   * trước (sales sửa tay trên CRM không bị ghi đè), bỏ field đã đúng trên CRM;
   * EMAIL, PHONE chỉ gửi giá trị chưa có; field nguồn không gửi lại.
   */
  private async updateLead(
    current: BitrixLead,
    fields: Record<string, unknown>,
    previous: Record<string, unknown> | null,
    warnings: SubmissionWarning[],
  ): Promise<void> {
    const changes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (CREATE_ONLY_FIELDS.includes(key)) continue;
      if (previous && stableStringify(previous[key]) === stableStringify(value))
        continue;
      if (key === 'EMAIL' || key === 'PHONE') {
        const added = newLeadValues(
          key,
          current[key],
          value as MultiFieldValue[],
        );
        if (added.length) changes[key] = added;
        continue;
      }
      if (stableStringify(current[key]) === stableStringify(value)) continue;
      changes[key] = value;
    }
    if (Object.keys(changes).length === 0) return;
    try {
      await this.bitrix.call('crm.lead.update', {
        id: Number(current.ID),
        fields: changes,
        params: { REGISTER_SONET_EVENT: 'N' },
      });
    } catch (error) {
      // Lead đã CONVERTED mà Bitrix24 từ chối cập nhật: bỏ qua, ghi cảnh báo.
      if (
        current.STATUS_ID === 'CONVERTED' &&
        error instanceof ExternalApiError &&
        error.kind === 'BAD_REQUEST'
      ) {
        warnings.push(
          warning(
            WARNING.LEAD_UPDATE_REJECTED,
            MSG.WARNING.LEAD_UPDATE_REJECTED(Number(current.ID), error.message),
          ),
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Một request batch: lead do ứng dụng tạo (ORIGIN_ID = uuid khách) và lead
   * trùng email, SĐT; bỏ các lead đã là bitrix24_id của khách khác trong DB.
   */
  private async lookup(manager: EntityManager, lead: Lead): Promise<CrmLookup> {
    const commands: Record<
      string,
      { method: string; params: Record<string, unknown> }
    > = {
      origin: {
        method: 'crm.lead.list',
        params: {
          filter: { ORIGINATOR_ID, ORIGIN_ID: lead.uuid },
          select: ['ID'],
        },
      },
    };
    if (lead.email) {
      commands.email = {
        method: 'crm.duplicate.findbycomm',
        params: { entity_type: 'LEAD', type: 'EMAIL', values: [lead.email] },
      };
    }
    if (lead.phone) {
      commands.phone = {
        method: 'crm.duplicate.findbycomm',
        params: { entity_type: 'LEAD', type: 'PHONE', values: [lead.phone] },
      };
    }
    const results = await this.bitrix.callBatch(commands);
    for (const result of Object.values(results)) {
      if (!result.ok) throw result.error;
    }
    const origin = results.origin.ok
      ? (results.origin.result as { ID: string }[])
      : [];
    const byEmail = results.email?.ok
      ? duplicateIds(results.email.result, 'LEAD')
      : [];
    const byPhone = results.phone?.ok
      ? duplicateIds(results.phone.result, 'LEAD')
      : [];
    const owned = await ownedByOthers(
      manager,
      'bitrix24_id',
      [...byEmail, ...byPhone],
      lead.uuid,
    );
    const { chosen, excluded } = pickCrmRecord([...byEmail, ...byPhone], owned);
    return {
      byOrigin: origin[0] ? Number(origin[0].ID) : null,
      chosen,
      excluded,
      excludedBy: excluded.some((id) => byEmail.includes(id)) ? 'email' : 'SĐT',
    };
  }

  private async getLead(id: number): Promise<BitrixLead | null> {
    try {
      return await this.bitrix.call<BitrixLead>('crm.lead.get', { id });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  private async getItem(
    entityTypeId: number,
    id: number,
  ): Promise<BitrixItem | null> {
    try {
      return (
        await this.bitrix.call<{ item: BitrixItem }>('crm.item.get', {
          entityTypeId,
          id,
        })
      ).item;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  private async history(
    manager: EntityManager,
    leadUuid: string,
  ): Promise<LeadHistory> {
    const repo = manager.getRepository(LeadSubmission);
    const [first, latest, channels] = await Promise.all([
      repo.findOneOrFail({
        where: { leadUuid },
        order: { submittedAt: 'ASC' },
      }),
      repo.findOneOrFail({
        where: { leadUuid },
        order: { submittedAt: 'DESC' },
      }),
      manager.query<{ channel_kbn: number }[]>(
        `SELECT channel_kbn FROM lead_submissions WHERE lead_uuid = $1
          GROUP BY channel_kbn ORDER BY min(submitted_at)`,
        [leadUuid],
      ),
    ]);
    return { first, latest, channels: channels.map((c) => c.channel_kbn) };
  }
}

/** Hash tên, email, SĐT đã đẩy lên Contact: chỉ đổi thì mới cập nhật Contact. */
export function contactHashOf(
  lead: Pick<Lead, 'name' | 'email' | 'phone'>,
): string {
  return hashFields({ name: lead.name, email: lead.email, phone: lead.phone });
}

/** Email, SĐT của khách theo dạng fm của Contact. */
export function contactValues(
  lead: Pick<Lead, 'email' | 'phone'>,
): { typeId: 'EMAIL' | 'PHONE'; value: string }[] {
  return [
    ...(lead.email ? [{ typeId: 'EMAIL' as const, value: lead.email }] : []),
    ...(lead.phone ? [{ typeId: 'PHONE' as const, value: lead.phone }] : []),
  ];
}

/** ID Bitrix24 trong danh sách đã thuộc khách khác trong DB (cột leads.bitrix24_id / bitrix_contact_id). */
export async function ownedByOthers(
  manager: EntityManager,
  column: 'bitrix24_id' | 'bitrix_contact_id',
  ids: number[],
  leadUuid: string,
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await manager.query<{ id: number }[]>(
    `SELECT ${column} AS id FROM leads WHERE ${column} = ANY($1::int[]) AND uuid <> $2`,
    [ids, leadUuid],
  );
  return new Set(rows.map((r) => Number(r.id)));
}
