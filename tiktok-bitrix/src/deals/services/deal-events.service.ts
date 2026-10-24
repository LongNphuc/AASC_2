import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Bitrix24Client } from '../../bitrix/clients/bitrix24.client';
import { isNotFound } from '../../bitrix/mappers/bitrix-error.mapper';
import {
  ENTITY_TYPE,
  ORIGINATOR_ID,
  type BitrixItem,
} from '../../bitrix/types/bitrix.types';
import { LOG, WARN } from '../../common/constants/messages.constant';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { DealStatusKbn, WebhookStatusKbn } from '../../common/kbn/status.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import type { JobContext } from '../../pipeline/jobs/job-context';
import type { StepOutcome } from '../../pipeline/jobs/step.types';
import { Deal } from '../entities/deal.entity';
import { DealRulesService, dealValuesFromItem } from './deal-rules.service';
import { ProbabilityService } from './probability.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Các bước của job bitrix-deal-event (readme_design.md mục 7): Bitrix24 chỉ báo
 * ID deal; ứng dụng luôn tự đọc deal qua API, không tin dữ liệu trong request.
 */
@Injectable()
export class DealEventsService {
  private readonly logger = new ServiceLogger(
    LogService.DEAL,
    DealEventsService.name,
  );

  constructor(
    private readonly bitrix: Bitrix24Client,
    private readonly rules: DealRulesService,
    private readonly probability: ProbabilityService,
  ) {}

  /** BX_DEAL_SYNC: cập nhật pipeline, stage, trạng thái, giá trị, người phụ trách. Chỉ đọc Bitrix24. */
  async syncDeal(ctx: JobContext): Promise<StepOutcome> {
    const bitrixId = ctx.event.bitrixDealId;
    const item = bitrixId ? await this.getDeal(bitrixId) : null;
    const deal = bitrixId ? await this.findDeal(ctx.db, bitrixId, item) : null;
    if (!deal) {
      // Deal sales tự tạo trên CRM: bỏ qua (60011, mục 19).
      return {
        finish: {
          statusKbn: WebhookStatusKbn.PROCESSED,
          errorKbn: ErrorKbn.DEAL_NOT_OWNED,
          errorDetail: { bitrixDealId: bitrixId },
        },
      };
    }
    const values: Partial<Deal> = item
      ? { ...dealValuesFromItem(item), bitrix24Id: bitrixId }
      : {
          statusKbn: DealStatusKbn.DELETED,
          closedAt: deal.closedAt ?? new Date(),
          updatedAt: new Date(),
        };
    // Sales có thể chuyển deal sang pipeline khác trên CRM (categoryId).
    let pipelineId =
      item?.categoryId !== undefined
        ? String(item.categoryId)
        : deal.pipelineId;
    if (
      values.statusKbn === DealStatusKbn.OPEN &&
      (await this.hasOtherOpenDeal(ctx.db, { ...deal, pipelineId }))
    ) {
      // Khách đã có deal mở khác ở pipeline đích (mỗi pipeline một deal mở):
      if (deal.statusKbn !== DealStatusKbn.OPEN) {
        // sales mở lại deal cũ: giữ trạng thái cũ trong DB, cập nhật stage;
        values.statusKbn = deal.statusKbn;
      } else {
        // deal đang mở bị chuyển sang pipeline đó: giữ pipeline cũ trong DB.
        this.logger.warn(
          WARN.DEAL.PIPELINE_KEPT(bitrixId!, deal.pipelineId, pipelineId),
        );
        pipelineId = deal.pipelineId;
      }
    }
    if (pipelineId !== deal.pipelineId) {
      values.pipelineId = pipelineId;
      this.logger.log(
        LOG.DEAL.PIPELINE_MOVED(bitrixId!, deal.pipelineId, pipelineId),
      );
    }
    this.logger.log(
      LOG.DEAL.STAGE_SYNCED(
        bitrixId!,
        values.stage ?? deal.stage,
        DealStatusKbn[values.statusKbn ?? deal.statusKbn],
      ),
    );
    return {
      commit: async (manager) => {
        await manager.update(Deal, { uuid: deal.uuid }, values);
      },
    };
  }

  /**
   * BX_PROBABILITY: xác suất theo stage mới (mục 6.3); khác giá trị trên
   * Bitrix24 thì gửi crm.item.update. Đọc lại deal vì lần chạy lại có thể bắt
   * đầu ở đây.
   */
  async syncProbability(ctx: JobContext): Promise<StepOutcome> {
    const deal = await this.dealOfEvent(ctx);
    if (!deal || deal.statusKbn === DealStatusKbn.DELETED || !deal.bitrix24Id)
      return {};
    const item = await this.getDeal(deal.bitrix24Id);
    if (!item) {
      return {
        commit: async (manager) => {
          await manager.update(
            Deal,
            { uuid: deal.uuid },
            {
              statusKbn: DealStatusKbn.DELETED,
              closedAt: deal.closedAt ?? new Date(),
              updatedAt: new Date(),
            },
          );
        },
      };
    }
    const rules = await this.rules.rules();
    const target =
      this.probability.forStage(
        rules.stage_probability,
        deal.pipelineId,
        item.stageId ?? deal.stage,
        item.stageSemanticId,
      ) ?? Number(item.probability ?? deal.probability);
    if (Number(item.probability) !== target) {
      // Bitrix24 sẽ gửi thêm một sự kiện; lần đó stage và xác suất đã khớp nên không gửi gì nữa.
      await this.bitrix.call('crm.item.update', {
        entityTypeId: ENTITY_TYPE.DEAL,
        id: deal.bitrix24Id,
        fields: { probability: target },
      });
    }
    return {
      commit: async (manager) => {
        await manager.update(
          Deal,
          { uuid: deal.uuid },
          { probability: target, updatedAt: new Date() },
        );
      },
    };
  }

  /** Deal của sự kiện Bitrix24 (theo bitrix24_id). */
  async dealOfEvent(ctx: JobContext): Promise<Deal | null> {
    const bitrixId = ctx.event.bitrixDealId;
    return bitrixId ? ctx.db.findOneBy(Deal, { bitrix24Id: bitrixId }) : null;
  }

  private async findDeal(
    manager: EntityManager,
    bitrixId: number,
    item: BitrixItem | null,
  ): Promise<Deal | null> {
    const byId = await manager.findOneBy(Deal, { bitrix24Id: bitrixId });
    if (byId) return byId;
    // Deal do ứng dụng tạo mà chưa kịp lưu bitrix24_id: tìm theo originId.
    if (
      item?.originatorId === ORIGINATOR_ID &&
      item.originId &&
      UUID_PATTERN.test(item.originId)
    ) {
      return manager.findOneBy(Deal, { uuid: item.originId });
    }
    return null;
  }

  private async hasOtherOpenDeal(
    manager: EntityManager,
    deal: Deal,
  ): Promise<boolean> {
    const count = await manager
      .getRepository(Deal)
      .createQueryBuilder('d')
      .where('d.lead_uuid = :leadUuid AND d.pipeline_id = :pipelineId', deal)
      .andWhere('d.status_kbn = :open AND d.uuid <> :uuid', {
        open: DealStatusKbn.OPEN,
        uuid: deal.uuid,
      })
      .getCount();
    return count > 0;
  }

  private async getDeal(id: number): Promise<BitrixItem | null> {
    try {
      return (
        await this.bitrix.call<{ item: BitrixItem }>('crm.item.get', {
          entityTypeId: ENTITY_TYPE.DEAL,
          id,
        })
      ).item;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
}
