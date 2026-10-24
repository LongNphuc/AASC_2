import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import type { Repository } from 'typeorm';
import {
  describeErrorKbn,
  isTransientErrorKbn,
} from '../../common/kbn/error.kbn';
import { JobStepKbn, WebhookStatusKbn } from '../../common/kbn/status.kbn';
import { kbnName, SourceKbn } from '../../common/kbn/type.kbn';
import { appConfig, type AppConfig } from '../../config/app-config';
import { WebhookEvent } from '../../webhooks/entities/webhook-event.entity';
import { jobIdFor, jobNameFor } from '../job-options';
import { QUEUE } from '../queue-names';

/**
 * GET /api/v1/ops/dead-letters: dead letter queue là tập job failed của BullMQ,
 * nơi ghi trạng thái là DB (readme_design.md mục 10.2). Đọc các dòng
 * webhook_events đang FAILED, kèm trạng thái job trong BullMQ để tham khảo.
 */
@Injectable()
export class DeadLetterService {
  constructor(
    @InjectRepository(WebhookEvent)
    private readonly events: Repository<WebhookEvent>,
    @InjectQueue(QUEUE.CRM_PIPELINE) private readonly queue: Queue,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async list(limit = 100) {
    const rows = await this.events.find({
      where: { statusKbn: WebhookStatusKbn.FAILED },
      order: { failedAt: 'DESC' },
      take: limit,
    });
    return Promise.all(
      rows.map(async (event) => {
        const jobId = jobIdFor(event);
        const job = await this.queue.getJob(jobId);
        const errorKbn = event.errorKbn ?? null;
        return {
          webhookEventUuid: event.uuid,
          provider: kbnName(SourceKbn, event.providerKbn),
          eventId: event.eventId,
          jobId,
          jobName: jobNameFor(event),
          jobState: job ? await job.getState() : 'missing',
          currentStepKbn: event.currentStepKbn,
          currentStep: event.currentStepKbn
            ? JobStepKbn[event.currentStepKbn]
            : null,
          errorKbn,
          error: errorKbn ? describeErrorKbn(errorKbn) : null,
          message:
            (event.errorDetail as { message?: string } | null)?.message ?? null,
          attemptCount: event.attemptCount,
          retryCount: event.retryCount,
          maxRetry: this.config.queue.recoveryMaxRounds,
          failedAt: event.failedAt,
          retryable: isTransientErrorKbn(errorKbn),
        };
      }),
    );
  }
}
