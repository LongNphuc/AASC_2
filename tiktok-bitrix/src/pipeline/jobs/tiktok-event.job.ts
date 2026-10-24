import { Injectable } from '@nestjs/common';
import { LOG } from '../../common/constants/messages.constant';
import { JobStepKbn, WebhookStatusKbn } from '../../common/kbn/status.kbn';
import { EventTypeKbn } from '../../common/kbn/type.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { jsonValue } from '../../database/json';
import { LeadSyncService } from '../../lead-sync/services/lead-sync.service';
import { TimelineService } from '../../lead-sync/services/timeline.service';
import { EngagementService } from '../../leads/services/engagement.service';
import { LeadEventNormalizer } from '../../leads/services/lead-event-normalizer.service';
import { LeadIngestService } from '../../leads/services/lead-ingest.service';
import { DealRulesService } from '../../deals/services/deal-rules.service';
import { DealSteps } from './deal-steps';
import type { JobContext } from './job-context';
import type { PipelineStep, StepOutcome } from './step.types';

/**
 * Job tiktok-event: một sự kiện TikTok (hoặc một bản ghi import), làm trọn
 * từ đầu tới cuối theo thứ tự (readme_design.md mục 2, 10.5):
 *
 *   1 kiểm, chuẩn hóa → 2 khách, lượt gửi → 3a lead → 3b Contact → 4 timeline
 *   → 5 rule → 6a Contact → 6b deal → 6c lead CONVERTED → 6d comment deal
 *   → 7a thông báo → 7b conversion (bước cuối: PROCESSED)
 */
@Injectable()
export class TiktokEventJob {
  private readonly logger = new ServiceLogger(
    LogService.LEAD,
    TiktokEventJob.name,
  );

  constructor(
    private readonly normalizer: LeadEventNormalizer,
    private readonly ingest: LeadIngestService,
    private readonly engagement: EngagementService,
    private readonly leadSync: LeadSyncService,
    private readonly timeline: TimelineService,
    private readonly dealRules: DealRulesService,
    private readonly dealSteps: DealSteps,
  ) {}

  steps(): PipelineStep[] {
    return [
      { kbn: JobStepKbn.CHECK_EVENT, run: (ctx) => this.checkEvent(ctx) },
      { kbn: JobStepKbn.SUBMISSION, run: (ctx) => this.submission(ctx) },
      { kbn: JobStepKbn.LEAD_SYNC, run: (ctx) => this.leadSync.syncLead(ctx) },
      {
        kbn: JobStepKbn.CONTACT_SYNC,
        run: (ctx) => this.leadSync.syncContact(ctx),
      },
      { kbn: JobStepKbn.TIMELINE, run: (ctx) => this.timeline.post(ctx) },
      { kbn: JobStepKbn.RULE, run: (ctx) => this.dealRules.evaluate(ctx) },
      ...this.dealSteps.steps({ includeHotLead: true }),
    ];
  }

  /**
   * Bước 1: kiểm sự kiện, chuẩn hóa, validate (mục 4.1–4.3). Sai thì INVALID
   * và kết thúc bình thường (không thử lại: gửi lại vẫn sai). user.interaction
   * chỉ ghi engagement_events rồi PROCESSED (mục 4.6).
   */
  private checkEvent(ctx: JobContext): Promise<StepOutcome> {
    return Promise.resolve(this.checkEventSync(ctx));
  }

  private checkEventSync(ctx: JobContext): StepOutcome {
    const { event } = ctx;
    if (event.eventTypeKbn === EventTypeKbn.USER_INTERACTION) {
      const result = this.normalizer.normalizeInteraction(event.payload);
      if (!result.ok) return invalid(result.errorKbn, result.errors);
      this.logger.log(LOG.LEAD.ENGAGEMENT(result.value.type));
      return {
        commit: (manager) =>
          this.engagement.record(manager, event, result.value),
        finish: { statusKbn: WebhookStatusKbn.PROCESSED },
      };
    }
    const result = this.normalizer.normalizeLead(event);
    if (!result.ok) return invalid(result.errorKbn, result.errors);
    return {};
  }

  /** Bước 2: tìm khách, gộp dữ liệu, tạo hoặc cập nhật lượt gửi (mục 4.4). Chỉ ghi DB. */
  private submission(ctx: JobContext): Promise<StepOutcome> {
    const { event } = ctx;
    const result = this.normalizer.normalizeLead(event);
    if (!result.ok)
      return Promise.resolve(invalid(result.errorKbn, result.errors));
    return Promise.resolve({
      commit: async (manager) => {
        const ingested = await this.ingest.ingest(
          manager,
          event,
          result.value,
          result.warnings,
        );
        this.logger.log(
          LOG.LEAD.INGESTED(
            ingested.completedExisting
              ? 'completed'
              : ingested.newLead
                ? 'new-lead'
                : 'existing-lead',
            ingested.leadUuid,
          ),
        );
      },
    });
  }
}

function invalid(
  errorKbn: number,
  errors: { field: string; message: string }[],
): StepOutcome {
  return {
    finish: {
      statusKbn: WebhookStatusKbn.INVALID,
      errorKbn,
      errorDetail: jsonValue({ errors }),
    },
  };
}
