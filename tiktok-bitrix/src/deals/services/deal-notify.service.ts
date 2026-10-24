import { Inject, Injectable } from '@nestjs/common';
import { NOTIFY } from '../../common/constants/messages.constant';
import { NotificationTypeKbn } from '../../common/kbn/type.kbn';
import { appConfig, type AppConfig } from '../../config/app-config';
import { NotificationService } from '../../notifications/services/notification.service';
import type { JobContext } from '../../pipeline/jobs/job-context';
import type { StepOutcome } from '../../pipeline/jobs/step.types';

/**
 * Bước 7a (readme_design.md mục 6.6): báo sales được giao deal mới, và (chỉ với
 * sự kiện TikTok) báo khách điểm cao. Thông báo lỗi không làm hỏng job.
 */
@Injectable()
export class DealNotifyService {
  constructor(
    private readonly notifications: NotificationService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async notify(ctx: JobContext, includeHotLead: boolean): Promise<StepOutcome> {
    const submission = await ctx.requireSubmission();
    const deal = await ctx.deal(submission.dealUuid);
    if (
      deal?.bitrix24Id &&
      deal.assignedTo &&
      deal.leadSubmissionUuid === submission.uuid
    ) {
      await this.notifications.notify(
        NotificationTypeKbn.DEAL_ASSIGNED,
        [deal.assignedTo],
        NOTIFY.DEAL_ASSIGNED(
          deal.title,
          deal.stage,
          deal.probability,
          `${(deal.amount ?? 0).toLocaleString('vi-VN')} ${deal.currency}`,
        ),
        { type: 'deal', uuid: deal.uuid },
      );
    }
    if (
      includeHotLead &&
      submission.qualityScore >= this.config.lead.hotLeadScore
    ) {
      await this.notifications.notify(
        NotificationTypeKbn.HOT_LEAD,
        this.config.notify.hotLeadUserIds,
        NOTIFY.HOT_LEAD(
          submission.qualityScore,
          submission.name,
          submission.campaignName,
        ),
        { type: 'submission', uuid: submission.uuid },
      );
    }
    return {};
  }
}
