import { Injectable } from '@nestjs/common';
import { JobStepKbn } from '../../common/kbn/status.kbn';
import { ConversionKbn } from '../../common/kbn/type.kbn';
import { ConversionService } from '../../conversions/services/conversion.service';
import { DealNotifyService } from '../../deals/services/deal-notify.service';
import { DealPushService } from '../../deals/services/deal-push.service';
import type { JobContext } from './job-context';
import type { PipelineStep, StepOutcome } from './step.types';

/**
 * Các bước 6a … 7b, dùng chung cho job tiktok-event và convert-deal
 * (readme_design.md mục 6.2, 10.5). Bước không có việc (lượt gửi không có
 * deal, deal đã lên Bitrix24) chỉ chuyển current_step_kbn sang bước sau.
 */
@Injectable()
export class DealSteps {
  constructor(
    private readonly dealPush: DealPushService,
    private readonly dealNotify: DealNotifyService,
    private readonly conversions: ConversionService,
  ) {}

  steps(options: { includeHotLead: boolean }): PipelineStep[] {
    return [
      {
        kbn: JobStepKbn.CONTACT,
        run: (ctx) => this.dealPush.ensureContact(ctx),
      },
      { kbn: JobStepKbn.DEAL, run: (ctx) => this.dealPush.pushDeal(ctx) },
      {
        kbn: JobStepKbn.LEAD_CONVERTED,
        run: (ctx) => this.dealPush.markLeadConverted(ctx),
      },
      {
        kbn: JobStepKbn.DEAL_COMMENT,
        run: (ctx) => this.dealPush.commentOnDeal(ctx),
      },
      {
        kbn: JobStepKbn.NOTIFY,
        run: (ctx) => this.dealNotify.notify(ctx, options.includeHotLead),
      },
      { kbn: JobStepKbn.CONVERSION, run: (ctx) => this.dealCreated(ctx) },
    ];
  }

  /** 7b: báo DEAL_CREATED cho deal mà lượt gửi này tạo ra (mục 8). */
  private async dealCreated(ctx: JobContext): Promise<StepOutcome> {
    const submission = await ctx.requireSubmission();
    const deal = await ctx.deal(submission.dealUuid);
    if (deal?.bitrix24Id && deal.leadSubmissionUuid === submission.uuid) {
      await this.conversions.ensureSent(deal, ConversionKbn.DEAL_CREATED);
    }
    return {};
  }
}
