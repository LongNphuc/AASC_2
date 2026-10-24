import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { JobStepKbn, WebhookStatusKbn } from '../../common/kbn/status.kbn';
import { DealOriginKbn } from '../../common/kbn/type.kbn';
import { LOG } from '../../common/constants/messages.constant';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import {
  applyUpdates,
  DealRulesService,
  insertDealRow,
} from '../../deals/services/deal-rules.service';
import { Lead } from '../../leads/entities/lead.entity';
import { LeadSubmission } from '../../leads/entities/lead-submission.entity';
import { WebhookEvent } from '../../webhooks/entities/webhook-event.entity';
import { DealSteps } from './deal-steps';
import type { JobContext } from './job-context';
import type { PipelineStep, StepOutcome } from './step.types';

/** Body của yêu cầu chuyển tay, lưu ở webhook_events.payload (provider MANUAL). */
export interface ConvertRequest {
  lead_uuid: string;
  lead_submission_uuid?: string;
  pipeline_id?: string;
  stage_id?: string;
  probability?: number;
  amount?: number;
  assigned_to?: number;
}

/**
 * Lượt gửi dùng cho deal tạo tay: lượt được chọn, hoặc lượt mới nhất chưa có
 * deal (readme_design.md mục 6.7). Dùng chung cho api (kiểm sơ bộ) và job.
 */
export async function submissionForConversion(
  manager: EntityManager,
  leadUuid: string,
  submissionUuid?: string,
): Promise<LeadSubmission | null> {
  const repo = manager.getRepository(LeadSubmission);
  if (submissionUuid) return repo.findOneBy({ uuid: submissionUuid, leadUuid });
  return repo
    .createQueryBuilder('s')
    .where('s.lead_uuid = :leadUuid AND s.deal_uuid IS NULL', { leadUuid })
    .orderBy('s.submitted_at', 'DESC')
    .getOne();
}

/**
 * Job convert-deal (readme_design.md mục 6.7): CONVERT_CHECK kiểm lại điều
 * kiện (lúc này là kiểm chính thức, vì job chạy lần lượt với mọi job khác),
 * tạo dòng deal với đúng dealUuid api đã sinh, rồi làm 6a … 7b như luồng tự
 * động. Điều kiện không còn đúng thì không tạo deal, ghi mã lỗi lên sự kiện.
 */
@Injectable()
export class ConvertDealJob {
  private readonly logger = new ServiceLogger(
    LogService.DEAL,
    ConvertDealJob.name,
  );

  constructor(
    private readonly dealRules: DealRulesService,
    private readonly dealSteps: DealSteps,
  ) {}

  steps(): PipelineStep[] {
    return [
      { kbn: JobStepKbn.CONVERT_CHECK, run: (ctx) => this.check(ctx) },
      ...this.dealSteps.steps({ includeHotLead: false }),
    ];
  }

  private async check(ctx: JobContext): Promise<StepOutcome> {
    const request = ctx.event.payload as unknown as ConvertRequest;
    const dealUuid = ctx.event.eventId;
    const lead = await ctx.db.findOneBy(Lead, { uuid: request.lead_uuid });
    if (!lead) return rejected(ErrorKbn.NOT_FOUND);
    if (!lead.bitrix24Id) return rejected(ErrorKbn.LEAD_NOT_IN_CRM);
    const submission = await submissionForConversion(
      ctx.db,
      lead.uuid,
      request.lead_submission_uuid,
    );
    if (!submission) {
      return rejected(
        request.lead_submission_uuid
          ? ErrorKbn.NOT_FOUND
          : ErrorKbn.SUBMISSION_HAS_DEAL,
      );
    }
    if (submission.dealUuid) return rejected(ErrorKbn.SUBMISSION_HAS_DEAL);

    const rules = await this.dealRules.rules();
    const matched = this.dealRules.matchRule(rules, submission);
    const { deal, afterCommit } = await this.dealRules.newDeal(
      lead,
      submission,
      rules,
      matched,
      {
        uuid: dealUuid,
        pipelineId: request.pipeline_id,
        stageId: request.stage_id,
        probability: request.probability,
        amount: request.amount,
        assignedTo: request.assigned_to,
        origin: DealOriginKbn.MANUAL,
      },
    );
    const open = await this.dealRules.findOpenDeal(
      ctx.db,
      lead.uuid,
      deal.pipelineId,
    );
    if (open.deal) {
      // Hiếm: job khác vừa tạo deal cùng pipeline giữa hai lần kiểm.
      return {
        ...rejected(ErrorKbn.DEAL_ALREADY_OPEN),
        commit: (m) => applyUpdates(m, open.updates),
      };
    }
    this.logger.log(LOG.DEAL.CREATED_ROW(deal.uuid));
    return {
      commit: async (manager) => {
        await applyUpdates(manager, open.updates);
        await insertDealRow(manager, deal, submission.uuid);
        await manager.update(
          WebhookEvent,
          { uuid: ctx.event.uuid },
          {
            leadSubmissionUuid: submission.uuid,
          },
        );
      },
      afterCommit,
    };
  }
}

function rejected(errorKbn: ErrorKbn): StepOutcome {
  return { finish: { statusKbn: WebhookStatusKbn.INVALID, errorKbn } };
}
