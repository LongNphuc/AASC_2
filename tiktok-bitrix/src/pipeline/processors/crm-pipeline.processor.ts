import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import type { Repository } from 'typeorm';
import { AlertService } from '../../analytics/services/alert.service';
import { ALERT, ERROR, WARN } from '../../common/constants/messages.constant';
import { isUnrecoverable, toJobError } from '../../common/errors/job-error';
import {
  describeErrorKbn,
  errorKbnOf,
  ErrorKbn,
  isTransientErrorKbn,
} from '../../common/kbn/error.kbn';
import { StatusKbn, WebhookStatusKbn } from '../../common/kbn/status.kbn';
import { AlertTypeKbn } from '../../common/kbn/type.kbn';
import { runInJobContext } from '../../common/logging/job-context';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import { jsonValue } from '../../database/json';
import { LeadSubmission } from '../../leads/entities/lead-submission.entity';
import { JOB, QUEUE, type PipelineJobData } from '../../queues/queue-names';
import { WebhookEvent } from '../../webhooks/entities/webhook-event.entity';
import { BitrixDealEventJob } from '../jobs/bitrix-deal-event.job';
import { ConvertDealJob } from '../jobs/convert-deal.job';
import {
  describeStep,
  FINISHED_STATUSES,
  StepRunner,
} from '../jobs/step-runner';
import type { PipelineStep } from '../jobs/step.types';
import { TiktokEventJob } from '../jobs/tiktok-event.job';

/**
 * Worker của queue crm-pipeline: một job mỗi lúc (concurrency 1, một process
 * worker), nên không có hai job cùng ghi một khách, một deal, và không cần
 * khóa nào (readme_design.md mục 10.1). Chọn danh sách bước theo tên job rồi
 * giao cho StepRunner.
 */
@Processor(QUEUE.CRM_PIPELINE, { concurrency: 1 })
export class CrmPipelineProcessor extends WorkerHost {
  private readonly logger = new ServiceLogger(
    LogService.JOB,
    CrmPipelineProcessor.name,
  );

  constructor(
    private readonly runner: StepRunner,
    private readonly tiktokEvent: TiktokEventJob,
    private readonly bitrixDealEvent: BitrixDealEventJob,
    private readonly convertDeal: ConvertDealJob,
    private readonly alerts: AlertService,
    @InjectRepository(WebhookEvent)
    private readonly events: Repository<WebhookEvent>,
    @InjectRepository(LeadSubmission)
    private readonly submissions: Repository<LeadSubmission>,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {
    super();
  }

  async process(job: Job<PipelineJobData>): Promise<string> {
    return runInJobContext(job.data.webhookEventUuid, async () => {
      const steps = this.stepsFor(job.name);
      if (!steps) {
        this.logger.warn(WARN.JOB.UNKNOWN_JOB(job.name));
        return 'unknown-job';
      }
      const event = await this.events.findOneBy({
        uuid: job.data.webhookEventUuid,
      });
      if (!event) {
        this.logger.warn(WARN.JOB.EVENT_MISSING(job.data.webhookEventUuid));
        return 'missing-event';
      }
      if (FINISHED_STATUSES.has(event.statusKbn))
        return WebhookStatusKbn[event.statusKbn];

      const startedAt = Date.now();
      try {
        const finish = await this.runner.run(event, job.name, steps);
        return WebhookStatusKbn[finish.statusKbn];
      } catch (error) {
        const jobError = toJobError(error);
        await this.onFailed(
          job,
          event.uuid,
          error,
          jobError,
          Date.now() - startedAt,
        );
        throw jobError;
      }
    });
  }

  private stepsFor(name: string): PipelineStep[] | null {
    switch (name) {
      case JOB.TIKTOK_EVENT:
        return this.tiktokEvent.steps();
      case JOB.BITRIX_DEAL_EVENT:
        return this.bitrixDealEvent.steps();
      case JOB.CONVERT_DEAL:
        return this.convertDeal.steps();
      default:
        return null;
    }
  }

  /**
   * Mỗi lần job lỗi: ghi một dòng vào service_job.log (bước, lần chạy, lượt
   * thử, vòng, mã lỗi). Hết lượt thử của vòng, hoặc lỗi không thử lại được:
   * sự kiện FAILED (current_step_kbn vẫn giữ bước chết), lượt gửi FAILED nếu
   * chưa SUCCESS, ghi app.log mức ERROR, và báo người xử lý (mục 10.2):
   *
   *   lỗi tạm thời, còn vòng recovery   → không báo, batch recovery chạy lại
   *   lỗi tạm thời, hết vòng recovery   → DLQ_NOT_EMPTY
   *   lỗi không tạm thời (kể cả 90001)  → SYNC_FAILED: recovery không chạy lại
   *                                       những lỗi này, không báo là nằm im
   */
  private async onFailed(
    job: Job<PipelineJobData>,
    eventUuid: string,
    original: unknown,
    jobError: Error,
    durationMs: number,
  ): Promise<void> {
    const errorKbn = errorKbnOf(jobError);
    const attempts = job.opts.attempts ?? 1;
    const attempt = job.attemptsMade + 1;
    const unrecoverable = isUnrecoverable(jobError);
    const final = unrecoverable || attempt >= attempts;
    const event = await this.events.findOneBy({ uuid: eventUuid });
    this.logger.record({
      level: 'ERROR',
      action: [
        job.name,
        `bước ${describeStep(event?.currentStepKbn)}`,
        `lần chạy ${event?.attemptCount ?? '-'}`,
        `thử ${attempt}/${attempts}`,
        `vòng ${event?.retryCount ?? 0}/${this.config.queue.recoveryMaxRounds}`,
      ].join(' · '),
      result: final ? 'FAILED' : 'RETRY',
      errorKbn,
      durationMs,
      detail: original instanceof Error ? original.message : String(original),
    });
    if (!final || !event) return;

    // Cùng tiêu chí với batch recovery và GET /api/v1/ops/dead-letters.
    const retryable = isTransientErrorKbn(errorKbn);
    const unexpected = errorKbn === ErrorKbn.UNKNOWN;
    this.logger.error(
      ERROR.SYSTEM.JOB_FAILED(
        job.name,
        eventUuid,
        describeStep(event.currentStepKbn),
        jobError.message,
      ),
      // Lỗi không lường trước thường là bug: giữ stack để tìm chỗ lỗi.
      unexpected && original instanceof Error ? original.stack : undefined,
    );
    const detail = jsonValue({
      message: jobError.message,
      step: event.currentStepKbn,
      retryable,
    });
    await this.events.update(
      { uuid: eventUuid },
      {
        statusKbn: WebhookStatusKbn.FAILED,
        errorKbn,
        errorDetail: detail,
        failedAt: new Date(),
        updatedAt: new Date(),
      },
    );
    if (event.leadSubmissionUuid) {
      await this.submissions
        .createQueryBuilder()
        .update()
        .set({
          syncStatusKbn: StatusKbn.FAILED,
          errorKbn,
          errorDetail: detail,
          updatedAt: new Date(),
        })
        .where('uuid = :uuid AND sync_status_kbn <> :success', {
          uuid: event.leadSubmissionUuid,
          success: StatusKbn.SUCCESS,
        })
        .execute();
    }
    if (retryable && event.retryCount >= this.config.queue.recoveryMaxRounds) {
      // Đủ số vòng recovery mà vẫn lỗi: để nguyên FAILED, báo người xử lý (60010).
      await this.alerts
        .raise(
          AlertTypeKbn.DLQ_NOT_EMPTY,
          `event:${eventUuid}`,
          ALERT.DLQ_NOT_EMPTY(1),
          {
            webhookEventUuid: eventUuid,
            errorKbn: ErrorKbn.RETRY_EXHAUSTED,
          },
        )
        .catch(() => undefined);
    }
    if (!retryable) {
      await this.alerts
        .raise(
          AlertTypeKbn.SYNC_FAILED,
          `event:${eventUuid}`,
          unexpected
            ? ALERT.UNEXPECTED_ERROR(job.name, eventUuid, jobError.message)
            : ALERT.SYNC_FAILED(
                job.name,
                eventUuid,
                errorKbn,
                describeErrorKbn(errorKbn),
              ),
          { webhookEventUuid: eventUuid, errorKbn, step: event.currentStepKbn },
        )
        .catch(() => undefined);
    }
  }
}
