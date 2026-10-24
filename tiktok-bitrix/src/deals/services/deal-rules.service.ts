import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { Bitrix24Client } from '../../bitrix/clients/bitrix24.client';
import { isNotFound } from '../../bitrix/mappers/bitrix-error.mapper';
import { ENTITY_TYPE, type BitrixItem } from '../../bitrix/types/bitrix.types';
import { LOG } from '../../common/constants/messages.constant';
import { DealStatusKbn } from '../../common/kbn/status.kbn';
import { DealOriginKbn } from '../../common/kbn/type.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import { ConfigurationService } from '../../configurations/services/configuration.service';
import {
  CONFIG_KEY,
  type DealRule,
  type DealRulesConfig,
} from '../../configurations/types/configuration.types';
import { jsonValue } from '../../database/json';
import { channelLabel } from '../../lead-sync/services/field-mapper.service';
import type { Lead } from '../../leads/entities/lead.entity';
import { LeadSubmission } from '../../leads/entities/lead-submission.entity';
import { budgetOf } from '../../leads/services/quality-score.service';
import type { JobContext } from '../../pipeline/jobs/job-context';
import type { StepOutcome } from '../../pipeline/jobs/step.types';
import { evaluateCondition } from '../../rules/condition-evaluator';
import { parseCondition } from '../../rules/condition-parser';
import { buildRuleContext } from '../../rules/rule-context';
import { Deal } from '../entities/deal.entity';
import { AssignmentService } from './assignment.service';
import { ProbabilityService } from './probability.service';
import { toBitrixStage } from './stage-code';

/** Cập nhật trạng thái một deal trong DB (deal đã đóng hoặc bị xóa trên CRM). */
export interface DealUpdate {
  uuid: string;
  values: Partial<Deal>;
}

/** Kết quả tìm deal đang mở của khách ở một pipeline. */
export interface OpenDealLookup {
  deal: Deal | null;
  /** Deal "đang mở" trong DB mà trên CRM đã thắng, thua hoặc bị xóa (webhook bị lỡ). */
  updates: DealUpdate[];
}

/** Dòng deal mới (chưa ghi DB) và việc làm sau khi commit (tăng lượt chia sales). */
export interface NewDeal {
  deal: Deal;
  afterCommit: () => Promise<void>;
}

/** Tham số tạo dòng deal; thiếu thì lấy như luồng tự động. */
export interface NewDealInput {
  uuid?: string;
  pipelineId?: string;
  stageId?: string;
  probability?: number;
  amount?: number;
  assignedTo?: number;
  origin: DealOriginKbn;
}

/** stageSemanticId của Bitrix24 → trạng thái deal trong DB. */
export function dealStatusOf(semantic: string | undefined): DealStatusKbn {
  if (semantic === 'S') return DealStatusKbn.WON;
  if (semantic === 'F') return DealStatusKbn.LOST;
  return DealStatusKbn.OPEN;
}

/**
 * Giá trị deal đọc về từ Bitrix24: stage, giá trị, người phụ trách do Bitrix24
 * làm chủ sau khi tạo (sales sửa trên CRM, ứng dụng chỉ đọc về, mục 6.3).
 */
export function dealValuesFromItem(item: BitrixItem): Partial<Deal> {
  const statusKbn = dealStatusOf(item.stageSemanticId);
  const now = new Date();
  return {
    stage: item.stageId,
    statusKbn,
    amount: Number(item.opportunity ?? 0),
    assignedTo: item.assignedById ? Number(item.assignedById) : null,
    closedAt:
      statusKbn === DealStatusKbn.OPEN
        ? null
        : item.closedate
          ? new Date(item.closedate)
          : now,
    bitrixSyncedAt: now,
    updatedAt: now,
  };
}

/**
 * Bước 5 của job tiktok-event: chạy rule, gắn lượt gửi vào deal đang mở hoặc
 * tạo dòng deal mới (readme_design.md mục 6.1, 6.2). Một khách nhiều deal,
 * một deal mở mỗi pipeline (readme_improvements.md mục 5).
 */
@Injectable()
export class DealRulesService {
  private readonly logger = new ServiceLogger(
    LogService.DEAL,
    DealRulesService.name,
  );

  constructor(
    private readonly bitrix: Bitrix24Client,
    private readonly configs: ConfigurationService,
    private readonly probability: ProbabilityService,
    private readonly assignment: AssignmentService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async evaluate(ctx: JobContext): Promise<StepOutcome> {
    const submission = await ctx.requireSubmission();
    // Lượt gửi đã có deal (form.complete hoàn tất lượt gửi cũ): giữ deal đó.
    if (submission.dealUuid) return {};
    const rules = await this.rules();
    const matched = this.matchRule(rules, submission);
    if (!matched) {
      this.logger.log(LOG.DEAL.NO_RULE);
      return {};
    }
    this.logger.log(
      LOG.DEAL.RULE_MATCHED(matched.index, matched.rule.pipeline_id),
    );
    const lead = await ctx.lead(submission.leadUuid);
    const open = await this.findOpenDeal(
      ctx.db,
      lead.uuid,
      matched.rule.pipeline_id,
    );
    if (open.deal) {
      const dealUuid = open.deal.uuid;
      this.logger.log(LOG.DEAL.ATTACHED(dealUuid));
      return {
        commit: async (manager) => {
          await applyUpdates(manager, open.updates);
          await manager.update(
            LeadSubmission,
            { uuid: submission.uuid },
            {
              dealUuid,
              updatedAt: new Date(),
            },
          );
        },
      };
    }
    const { deal, afterCommit } = await this.newDeal(
      lead,
      submission,
      rules,
      matched,
      { origin: DealOriginKbn.RULE },
    );
    this.logger.log(LOG.DEAL.CREATED_ROW(deal.uuid));
    return {
      commit: async (manager) => {
        // Deal cũ hết OPEN trước, rồi mới thêm deal mới (unique index một phần).
        await applyUpdates(manager, open.updates);
        await insertDealRow(manager, deal, submission.uuid);
      },
      afterCommit,
    };
  }

  async rules(): Promise<DealRulesConfig> {
    return (await this.configs.get<DealRulesConfig>(CONFIG_KEY.DEAL_RULES))
      .value;
  }

  /** Rule đầu tiên khớp payload của lượt gửi; không có thì null. */
  matchRule(
    rules: DealRulesConfig,
    submission: LeadSubmission,
  ): { index: number; rule: DealRule } | null {
    const context = buildRuleContext(submission);
    const index = rules.deal_rules.findIndex((rule) =>
      evaluateCondition(parseCondition(rule.condition), context),
    );
    return index < 0 ? null : { index, rule: rules.deal_rules[index] };
  }

  /**
   * Deal OPEN của khách ở pipeline (trong DB). Deal đã có trên Bitrix24 thì
   * đọc lại (mục 5.5): đang xử lý thì dùng; đã thắng, thua thì cập nhật như
   * job bitrix-deal-event và coi như không có deal mở; không còn thì DELETED.
   * Deal chưa có bitrix24_id (sự kiện khác vừa tạo dòng deal) thì dùng luôn.
   */
  async findOpenDeal(
    manager: EntityManager,
    leadUuid: string,
    pipelineId: string,
  ): Promise<OpenDealLookup> {
    const deal = await manager.findOneBy(Deal, {
      leadUuid,
      pipelineId,
      statusKbn: DealStatusKbn.OPEN,
    });
    if (!deal || !deal.bitrix24Id) return { deal, updates: [] };
    let item: BitrixItem | null = null;
    try {
      item = (
        await this.bitrix.call<{ item: BitrixItem }>('crm.item.get', {
          entityTypeId: ENTITY_TYPE.DEAL,
          id: deal.bitrix24Id,
        })
      ).item;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (!item) {
      this.logger.log(LOG.DEAL.CLOSED_MISSED(deal.uuid, 'DELETED'));
      return {
        deal: null,
        updates: [
          {
            uuid: deal.uuid,
            values: {
              statusKbn: DealStatusKbn.DELETED,
              closedAt: new Date(),
              updatedAt: new Date(),
            },
          },
        ],
      };
    }
    if (dealStatusOf(item.stageSemanticId) === DealStatusKbn.OPEN) {
      return { deal, updates: [] };
    }
    const values = dealValuesFromItem(item);
    this.logger.log(
      LOG.DEAL.CLOSED_MISSED(deal.uuid, DealStatusKbn[values.statusKbn!]),
    );
    return { deal: null, updates: [{ uuid: deal.uuid, values }] };
  }

  /** Dựng dòng deal mới (chưa ghi DB), cho cả luồng rule và chuyển tay. */
  async newDeal(
    lead: Lead,
    submission: LeadSubmission,
    rules: DealRulesConfig,
    matched: { index: number; rule: DealRule } | null,
    input: NewDealInput,
  ): Promise<NewDeal> {
    const rule = matched?.rule;
    const pipelineId = resolvePipeline(rules, matched, input.pipelineId);
    const shortStage =
      input.stageId ??
      (rule && rule.pipeline_id === pipelineId ? rule.stage_id : undefined) ??
      Object.keys(rules.stage_probability[pipelineId] ?? {})[0] ??
      'NEW';
    const stage = toBitrixStage(pipelineId, shortStage);
    let assignedTo = input.assignedTo ?? rule?.assigned_to;
    let afterCommit = () => Promise.resolve();
    if (assignedTo === undefined) {
      const pick = await this.assignment.pick(
        rules.assignment_rules,
        buildRuleContext(submission),
      );
      assignedTo = pick.userId ?? undefined;
      afterCommit = pick.advance;
    }
    const deal = new Deal();
    Object.assign(deal, {
      uuid: input.uuid ?? randomUUID(),
      leadUuid: lead.uuid,
      leadSubmissionUuid: submission.uuid,
      bitrix24Id: null,
      title: `${lead.name} · ${submission.campaignName ?? channelLabel(submission.channelKbn)}`,
      pipelineId,
      stage,
      statusKbn: DealStatusKbn.OPEN,
      originKbn: input.origin,
      ruleSnapshot: matched ? { index: matched.index, ...matched.rule } : null,
      probability:
        input.probability ??
        this.probability.initial(
          rule && rule.pipeline_id === pipelineId
            ? rule.probability
            : undefined,
          rules.stage_probability,
          pipelineId,
          stage,
          submission.qualityScore,
        ),
      amount: input.amount ?? budgetOf(submission.answers) ?? 0,
      currency: this.config.lead.currency,
      assignedTo: assignedTo ?? null,
    } satisfies Partial<Deal>);
    return { deal, afterCommit };
  }
}

/**
 * Pipeline của deal mới: tham số chuyển tay, rồi pipeline của rule khớp, rồi
 * pipeline của rule đầu tiên, rồi pipeline đầu tiên trong stage_probability.
 */
export function resolvePipeline(
  rules: DealRulesConfig,
  matched: { rule: DealRule } | null,
  requested?: string,
): string {
  return (
    requested ??
    matched?.rule.pipeline_id ??
    rules.deal_rules[0]?.pipeline_id ??
    Object.keys(rules.stage_probability)[0] ??
    '0'
  );
}

export async function applyUpdates(
  manager: EntityManager,
  updates: DealUpdate[],
): Promise<void> {
  for (const update of updates) {
    await manager.update(Deal, { uuid: update.uuid }, update.values);
  }
}

/** Thêm dòng deal (bitrix24_id trống) và gắn lượt gửi tạo ra nó. */
export async function insertDealRow(
  manager: EntityManager,
  deal: Deal,
  submissionUuid: string,
): Promise<void> {
  await manager.insert(Deal, {
    uuid: deal.uuid,
    leadUuid: deal.leadUuid,
    leadSubmissionUuid: deal.leadSubmissionUuid,
    title: deal.title,
    pipelineId: deal.pipelineId,
    stage: deal.stage,
    statusKbn: deal.statusKbn,
    originKbn: deal.originKbn,
    ruleSnapshot: deal.ruleSnapshot ? jsonValue(deal.ruleSnapshot) : null,
    probability: deal.probability,
    amount: deal.amount,
    currency: deal.currency,
    assignedTo: deal.assignedTo,
  });
  await manager.update(
    LeadSubmission,
    { uuid: submissionUuid },
    {
      dealUuid: deal.uuid,
      updatedAt: new Date(),
    },
  );
}
