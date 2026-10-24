import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { LOG } from '../../common/constants/messages.constant';
import { transientErrorKbns } from '../../common/kbn/error.kbn';
import { WebhookStatusKbn } from '../../common/kbn/status.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import { WebhookEvent } from '../../webhooks/entities/webhook-event.entity';
import { PipelineQueueService } from './pipeline-queue.service';

export interface RecoveryOptions {
  /** Chạy tay: bỏ điều kiện chờ 5 phút / 30 phút. */
  manual?: boolean;
  /** Chạy lại đúng một sự kiện, kể cả khi đã đủ số vòng hoặc lỗi không thử lại được; đặt retry_count về 0. */
  webhookEventUuid?: string;
}

export interface RecoveryResult {
  retried: number;
  readded: number;
  skipped: number;
}

const BATCH_LIMIT = 100;

/**
 * Batch recovery (readme_design.md mục 10.3): đọc DB để biết sự kiện nào chưa
 * xong, rồi hỏi BullMQ trạng thái job tương ứng để chọn cách chạy lại:
 *
 *   failed (dead letter queue) → job.retry('failed', { resetAttemptsMade })   retry_count + 1
 *   không có (Redis mất, job đã bị dọn) → thêm lại job với đúng jobId cũ     retry_count + 1
 *   đang chờ, đang chạy → bỏ qua
 *
 * DB là nơi duy nhất quyết định còn việc gì; đủ RECOVERY_MAX_ROUNDS vòng thì
 * dòng ra khỏi diện quét.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new ServiceLogger(
    LogService.JOB,
    RecoveryService.name,
  );

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly events: Repository<WebhookEvent>,
    private readonly producer: PipelineQueueService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async run(options: RecoveryOptions = {}): Promise<RecoveryResult> {
    const rows = options.webhookEventUuid
      ? await this.single(options.webhookEventUuid)
      : await this.candidates(!!options.manual);
    const result: RecoveryResult = { retried: 0, readded: 0, skipped: 0 };
    for (const event of rows) {
      const action = await this.recover(event);
      result[action]++;
      this.logger.record({
        action: LOG.JOB.RECOVERY_ONE(event.uuid, action),
        result: action.toUpperCase(),
      });
    }
    this.logger.log(
      LOG.JOB.RECOVERY_RUN(result.retried, result.readded, result.skipped),
    );
    return result;
  }

  private async recover(event: WebhookEvent): Promise<keyof RecoveryResult> {
    const action = await this.producer.requeue(event);
    // Mỗi lần batch chạy lại là một vòng (retry_count), đủ vòng thì thôi quét.
    if (action !== 'skipped') await this.bumpRetry(event.uuid);
    return action;
  }

  /** Sự kiện chưa xong: FAILED vì lỗi tạm thời, hoặc RECEIVED quá lâu (có thể đã mất job). */
  private candidates(manual: boolean): Promise<WebhookEvent[]> {
    return this.events
      .createQueryBuilder('e')
      .where('e.retry_count < :max', {
        max: this.config.queue.recoveryMaxRounds,
      })
      .andWhere(
        manual
          ? `((e.status_kbn = :failed AND e.error_kbn IN (:...transient)) OR e.status_kbn = :received)`
          : `((e.status_kbn = :failed AND e.error_kbn IN (:...transient) AND e.failed_at < now() - interval '5 minutes')
              OR (e.status_kbn = :received AND e.updated_at < now() - interval '30 minutes'))`,
        {
          failed: WebhookStatusKbn.FAILED,
          received: WebhookStatusKbn.RECEIVED,
          transient: transientErrorKbns(),
        },
      )
      .orderBy('e.received_at', 'ASC')
      .limit(BATCH_LIMIT)
      .getMany();
  }

  private async single(uuid: string): Promise<WebhookEvent[]> {
    const event = await this.events.findOneBy({ uuid });
    if (
      !event ||
      ![WebhookStatusKbn.FAILED, WebhookStatusKbn.RECEIVED].includes(
        event.statusKbn,
      )
    ) {
      return [];
    }
    await this.events.update({ uuid }, { retryCount: 0 });
    return [{ ...event, retryCount: 0 }];
  }

  private async bumpRetry(uuid: string): Promise<void> {
    await this.events.increment({ uuid }, 'retryCount', 1);
  }
}
