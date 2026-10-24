import { Inject, Injectable } from '@nestjs/common';
import { Bitrix24Client } from '../../bitrix/clients/bitrix24.client';
import { isNotFound } from '../../bitrix/mappers/bitrix-error.mapper';
import {
  ENTITY_TYPE,
  ORIGINATOR_ID,
  type BatchCommand,
  type BatchResult,
  type BitrixItem,
  type BitrixLead,
} from '../../bitrix/types/bitrix.types';
import { LOG, MSG } from '../../common/constants/messages.constant';
import { LeadStatusKbn } from '../../common/kbn/status.kbn';
import { logCode } from '../../common/logging/job-context';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import {
  duplicateIds,
  pickCrmRecord,
} from '../../lead-sync/services/bitrix-lead-matcher';
import { FieldMapperService } from '../../lead-sync/services/field-mapper.service';
import { mergeContactFm } from '../../lead-sync/services/multifield-diff';
import {
  contactHashOf,
  contactValues,
  ownedByOthers,
} from '../../lead-sync/services/lead-sync.service';
import { timelineBuilder } from '../../lead-sync/services/timeline.builder';
import { postComment } from '../../lead-sync/services/timeline.service';
import { Lead } from '../../leads/entities/lead.entity';
import { LeadSubmission } from '../../leads/entities/lead-submission.entity';
import {
  warning,
  WARNING,
} from '../../leads/services/lead-event-normalizer.service';
import type { JobContext } from '../../pipeline/jobs/job-context';
import type { StepOutcome } from '../../pipeline/jobs/step.types';
import { Deal } from '../entities/deal.entity';

/** Dữ liệu Bitrix24 đọc một lần trước bước 6a, dùng lại ở 6b, 6c trong cùng lần chạy. */
interface DealPrefetch {
  /** Contact đã lưu ở leads.bitrix_contact_id (null: không còn trên CRM). */
  storedContact?: BitrixItem | null;
  contactLookup?: { byOrigin: number | null; byComm: number[] };
  /** Deal tìm theo originId = deals.uuid (lần chạy trước đã tạo mà chưa lưu ID). */
  dealByOrigin?: number | null;
  crmLead?: BitrixLead | null;
}

const PREFETCH_KEY = 'dealPrefetch';

/**
 * Bước 6 của job tiktok-event và convert-deal (readme_design.md mục 6.2): làm
 * đủ ba việc như khi sales tự chuyển lead trên giao diện Bitrix24 (Contact,
 * deal gắn lead và Contact, lead sang CONVERTED), rồi comment lên deal. Các
 * lệnh đọc trước khi ghi của 6a–6c gộp một request batch.
 */
@Injectable()
export class DealPushService {
  private readonly logger = new ServiceLogger(
    LogService.DEAL,
    DealPushService.name,
  );

  constructor(
    private readonly bitrix: Bitrix24Client,
    private readonly mapper: FieldMapperService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  /** 6a: Contact của khách. Chỉ cần khi deal chưa lên Bitrix24. */
  async ensureContact(ctx: JobContext): Promise<StepOutcome> {
    const { submission, lead, deal } = await this.load(ctx);
    if (!deal || deal.bitrix24Id) return {};
    const pre = await this.prefetch(ctx, lead, deal, true);

    if (lead.bitrixContactId && pre.storedContact) return {};
    // Contact đã lưu không còn: tra như khách chưa có Contact.
    const lookup =
      pre.contactLookup ??
      (await this.prefetch(ctx, lead, deal, true, true)).contactLookup!;
    let contactId = lookup.byOrigin;
    if (!contactId) {
      const owned = await ownedByOthers(
        ctx.db,
        'bitrix_contact_id',
        lookup.byComm,
        lead.uuid,
      );
      contactId = pickCrmRecord(lookup.byComm, owned).chosen;
    }
    // Contact có sẵn: thêm email/SĐT còn thiếu ngay, vì hash lưu bên dưới làm
    // bước 3b về sau coi như Contact đã đồng bộ.
    if (contactId) contactId = await this.fillContact(contactId, lead);
    if (!contactId) {
      const result = await this.bitrix.call<{ item: BitrixItem }>(
        'crm.item.add',
        {
          entityTypeId: ENTITY_TYPE.CONTACT,
          fields: {
            name: lead.name,
            fm: contactValues(lead).map((v) => ({ ...v, valueType: 'WORK' })),
            leadId: lead.bitrix24Id,
            sourceId: this.mapper.sourceId(submission.channelKbn),
            assignedById: deal.assignedTo ?? undefined,
            originatorId: ORIGINATOR_ID,
            originId: lead.uuid,
          },
        },
      );
      contactId = Number(result.item.id);
    }
    const id = contactId;
    return {
      commit: async (manager) => {
        await manager.update(
          Lead,
          { uuid: lead.uuid },
          {
            bitrixContactId: id,
            bitrixContactHash: contactHashOf(lead),
            updatedAt: new Date(),
          },
        );
      },
    };
  }

  /**
   * Contact tìm thấy theo originId hoặc email/SĐT: chỉ thêm email/SĐT chưa có
   * (như bước 3b), không đổi tên sales đã nhập. Contact vừa bị xóa thì null
   * để tạo mới.
   */
  private async fillContact(id: number, lead: Lead): Promise<number | null> {
    let contact: BitrixItem;
    try {
      contact = (
        await this.bitrix.call<{ item: BitrixItem }>('crm.item.get', {
          entityTypeId: ENTITY_TYPE.CONTACT,
          id,
        })
      ).item;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    const fm = mergeContactFm(contact.fm, contactValues(lead));
    if (fm) {
      await this.bitrix.call('crm.item.update', {
        entityTypeId: ENTITY_TYPE.CONTACT,
        id,
        fields: { fm },
      });
    }
    return id;
  }

  /** 6b: deal trên Bitrix24, gắn lead và Contact (crm.item.add cho ghi leadId). */
  async pushDeal(ctx: JobContext): Promise<StepOutcome> {
    const { submission, lead, deal } = await this.load(ctx);
    if (!deal || deal.bitrix24Id) return {};
    const pre = await this.prefetch(ctx, lead, deal, false);
    let bitrixId = pre.dealByOrigin ?? null;
    if (!bitrixId) {
      const result = await this.bitrix.call<{ item: BitrixItem }>(
        'crm.item.add',
        {
          entityTypeId: ENTITY_TYPE.DEAL,
          fields: {
            title: deal.title,
            categoryId: Number(deal.pipelineId),
            stageId: deal.stage,
            probability: deal.probability,
            opportunity: deal.amount ?? 0,
            currencyId: deal.currency,
            assignedById: deal.assignedTo ?? undefined,
            leadId: lead.bitrix24Id,
            contactIds: lead.bitrixContactId ? [lead.bitrixContactId] : [],
            sourceId: this.mapper.sourceId(submission.channelKbn),
            originatorId: ORIGINATOR_ID,
            originId: deal.uuid,
            utmSource: submission.utmSource ?? undefined,
            utmCampaign: submission.utmCampaign ?? undefined,
          },
        },
      );
      bitrixId = Number(result.item.id);
    }
    this.logger.log(LOG.DEAL.PUSHED(bitrixId));
    const id = bitrixId;
    return {
      commit: async (manager) => {
        await manager.update(
          Deal,
          { uuid: deal.uuid },
          {
            bitrix24Id: id,
            bitrixSyncedAt: new Date(),
            updatedAt: new Date(),
          },
        );
      },
    };
  }

  /**
   * 6c: lead sang CONVERTED, đặt một lần khi khách có deal đầu tiên; sau đó
   * sales làm chủ trạng thái lead (mục 5.3). Đã CONVERTED trên CRM thì chỉ lưu DB.
   */
  async markLeadConverted(ctx: JobContext): Promise<StepOutcome> {
    const { submission, lead, deal } = await this.load(ctx);
    if (!deal || lead.statusKbn === LeadStatusKbn.CONVERTED || !lead.bitrix24Id)
      return {};
    const cached = ctx.cache.get(PREFETCH_KEY) as DealPrefetch | undefined;
    const crmLead =
      cached?.crmLead !== undefined
        ? cached.crmLead
        : await this.getLead(lead.bitrix24Id);
    if (!crmLead) {
      const gone = warning(
        WARNING.LEAD_GONE,
        MSG.WARNING.LEAD_GONE(lead.bitrix24Id),
      );
      return {
        commit: async (manager) => {
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
    if (crmLead.STATUS_ID !== 'CONVERTED') {
      await this.bitrix.call('crm.lead.update', {
        id: lead.bitrix24Id,
        fields: { STATUS_ID: 'CONVERTED' },
      });
    }
    return {
      commit: async (manager) => {
        await manager.update(
          Lead,
          { uuid: lead.uuid },
          {
            statusKbn: LeadStatusKbn.CONVERTED,
            updatedAt: new Date(),
          },
        );
      },
    };
  }

  /**
   * 6d: comment lên deal về lượt gửi này (lượt tạo ra deal, hoặc lượt gắn
   * thêm vào deal đang mở). Lượt gửi đã có comment thì không comment lại; bị
   * từ chối thì ghi cảnh báo, vẫn sang bước 7.
   */
  async commentOnDeal(ctx: JobContext): Promise<StepOutcome> {
    const { submission, deal } = await this.load(ctx);
    if (!deal?.bitrix24Id || submission.dealCommentPostedAt) return {};
    const created = deal.leadSubmissionUuid === submission.uuid;
    const result = await postComment(
      this.bitrix,
      { entityType: 'deal', entityId: deal.bitrix24Id },
      timelineBuilder.deal(submission, created, logCode(ctx.event.uuid)),
    );
    return {
      commit: async (manager) => {
        await manager.update(
          LeadSubmission,
          { uuid: submission.uuid },
          result.ok
            ? { dealCommentPostedAt: new Date(), updatedAt: new Date() }
            : {
                warnings: [...submission.warnings, result.warning],
                updatedAt: new Date(),
              },
        );
      },
    };
  }

  private async load(ctx: JobContext) {
    const submission = await ctx.requireSubmission();
    const lead = await ctx.lead(submission.leadUuid);
    const deal = await ctx.deal(submission.dealUuid);
    return { submission, lead, deal };
  }

  /**
   * Một request batch cho phần 6a–6c còn phải làm: Contact (theo ID đã lưu,
   * hoặc theo originId + email/SĐT), deal theo originId, lead. Kết quả giữ
   * trong ctx.cache; lần chạy lại bắt đầu ở 6b thì không đọc Contact.
   */
  private async prefetch(
    ctx: JobContext,
    lead: Lead,
    deal: Deal,
    includeContact: boolean,
    forceContactLookup = false,
  ): Promise<DealPrefetch> {
    const cached = ctx.cache.get(PREFETCH_KEY) as DealPrefetch | undefined;
    if (cached && !forceContactLookup) return cached;
    const commands: Record<string, BatchCommand> = {};
    if (includeContact) {
      if (lead.bitrixContactId && !forceContactLookup) {
        commands.contact = {
          method: 'crm.item.get',
          params: {
            entityTypeId: ENTITY_TYPE.CONTACT,
            id: lead.bitrixContactId,
          },
        };
      } else {
        commands.contactOrigin = {
          method: 'crm.item.list',
          params: {
            entityTypeId: ENTITY_TYPE.CONTACT,
            filter: { originatorId: ORIGINATOR_ID, originId: lead.uuid },
            select: ['id'],
          },
        };
        for (const value of contactValues(lead)) {
          commands[`contact${value.typeId}`] = {
            method: 'crm.duplicate.findbycomm',
            params: {
              entity_type: 'CONTACT',
              type: value.typeId,
              values: [value.value],
            },
          };
        }
      }
    }
    if (!forceContactLookup && !deal.bitrix24Id) {
      commands.deal = {
        method: 'crm.item.list',
        params: {
          entityTypeId: ENTITY_TYPE.DEAL,
          filter: { originatorId: ORIGINATOR_ID, originId: deal.uuid },
          select: ['id'],
        },
      };
    }
    if (
      !forceContactLookup &&
      lead.bitrix24Id &&
      lead.statusKbn !== LeadStatusKbn.CONVERTED
    ) {
      commands.lead = {
        method: 'crm.lead.get',
        params: { id: lead.bitrix24Id },
      };
    }
    const results = await this.bitrix.callBatch(commands);
    const prefetch: DealPrefetch = { ...(cached ?? {}) };
    if (commands.contact)
      prefetch.storedContact =
        optional<{ item: BitrixItem }>(results.contact)?.item ?? null;
    if (commands.contactOrigin) {
      const items = required<{ items: BitrixItem[] }>(
        results.contactOrigin,
      ).items;
      prefetch.contactLookup = {
        byOrigin: items[0] ? Number(items[0].id) : null,
        byComm: [
          ...duplicateIds(
            results.contactEMAIL ? required(results.contactEMAIL) : [],
            'CONTACT',
          ),
          ...duplicateIds(
            results.contactPHONE ? required(results.contactPHONE) : [],
            'CONTACT',
          ),
        ],
      };
    }
    if (commands.deal) {
      const items = required<{ items: BitrixItem[] }>(results.deal).items;
      prefetch.dealByOrigin = items[0] ? Number(items[0].id) : null;
    }
    if (commands.lead)
      prefetch.crmLead = optional<BitrixLead>(results.lead) ?? null;
    ctx.cache.set(PREFETCH_KEY, prefetch);
    return prefetch;
  }

  private async getLead(id: number): Promise<BitrixLead | null> {
    try {
      return await this.bitrix.call<BitrixLead>('crm.lead.get', { id });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
}

/** Kết quả lệnh trong batch; lỗi thì ném ra. */
function required<T>(result: BatchResult | undefined): T {
  if (!result) throw new Error('Thiếu kết quả batch');
  if (!result.ok) throw result.error;
  return result.result as T;
}

/** Như required nhưng bản ghi không còn thì trả null. */
function optional<T>(result: BatchResult | undefined): T | null {
  if (result && !result.ok && isNotFound(result.error)) return null;
  return required<T>(result);
}
