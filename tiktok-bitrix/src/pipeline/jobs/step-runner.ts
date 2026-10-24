import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ERROR, LOG } from '../../common/constants/messages.constant';
import {
  JOB_STEP_LABEL,
  JobStepKbn,
  WebhookStatusKbn,
} from '../../common/kbn/status.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { WebhookEvent } from '../../webhooks/entities/webhook-event.entity';
import { JobContext } from './job-context';
import type { PipelineStep, StepFinish } from './step.types';

/** Tên bước cho log: "11109 LEAD_CONVERTED (6c)". */
export function describeStep(step: number | null | undefined): string {
  if (!step) return '-';
  const name = JobStepKbn[step] ?? 'UNKNOWN';
  const label = JOB_STEP_LABEL[step];
  return `${step} ${name}${label ? ` (${label})` : ''}`;
}

/** Trạng thái đã xong: job gặp lại thì dừng ngay. */
export const FINISHED_STATUSES = new Set<number>([
  WebhookStatusKbn.PROCESSED,
  WebhookStatusKbn.IGNORED,
  WebhookStatusKbn.INVALID,
]);

/**
 * Chạy danh sách bước của một job từ current_step_kbn (readme_design.md mục
 * 2.1, 10.5):
 *
 *   attempt_count + 1, bỏ các bước đứng trước current_step_kbn
 *   với mỗi bước: gọi bước (Bitrix24/TikTok nếu cần)
 *     BEGIN; ghi dữ liệu của bước; current_step_kbn = bước sau; COMMIT
 *     (bước cuối: status PROCESSED, current_step_kbn NULL)
 *   lỗi thì ném ra: dữ liệu các bước trước giữ nguyên, cột giữ đúng bước chết
 *
 * Bước đã COMMIT chắc chắn không chạy lại; bước chưa COMMIT thì như chưa chạy.
 */
@Injectable()
export class StepRunner {
  private readonly logger = new ServiceLogger(LogService.JOB, StepRunner.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async run(
    event: WebhookEvent,
    jobName: string,
    steps: PipelineStep[],
  ): Promise<StepFinish> {
    const startIndex = event.currentStepKbn
      ? steps.findIndex((s) => s.kbn === event.currentStepKbn)
      : 0;
    if (startIndex < 0) {
      throw new Error(
        ERROR.SYSTEM.UNKNOWN_STEP(event.currentStepKbn!, jobName),
      );
    }
    await this.dataSource.query(
      `UPDATE webhook_events
          SET attempt_count = attempt_count + 1,
              status_kbn = $2,
              updated_at = now()
        WHERE uuid = $1`,
      [event.uuid, WebhookStatusKbn.RECEIVED],
    );
    const ctx = new JobContext(event, jobName, this.dataSource.manager);
    await ctx.refreshEvent();
    this.logger.log(
      LOG.JOB.STARTED(
        jobName,
        ctx.event.attemptCount,
        describeStep(steps[startIndex].kbn),
      ),
    );

    for (let index = startIndex; index < steps.length; index++) {
      const step = steps[index];
      ctx.step = step.kbn;
      const startedAt = Date.now();
      const outcome = (await step.run(ctx)) ?? {};
      const next = steps[index + 1];
      const finish: StepFinish | undefined =
        outcome.finish ??
        (next ? undefined : { statusKbn: WebhookStatusKbn.PROCESSED });

      await this.dataSource.transaction(async (manager) => {
        await outcome.commit?.(manager);
        await manager.update(
          WebhookEvent,
          { uuid: event.uuid },
          finish
            ? {
                statusKbn: finish.statusKbn,
                currentStepKbn: null,
                errorKbn: finish.errorKbn ?? null,
                errorDetail: finish.errorDetail ?? null,
                processedAt: new Date(),
                updatedAt: new Date(),
              }
            : { currentStepKbn: next.kbn, updatedAt: new Date() },
        );
      });
      await outcome.afterCommit?.();
      this.logger.record({
        action: `${jobName} · bước ${describeStep(step.kbn)}`,
        result: 'DONE',
        durationMs: Date.now() - startedAt,
      });
      if (finish) {
        this.logger.record({
          action: `${jobName}`,
          result: WebhookStatusKbn[finish.statusKbn],
          errorKbn: finish.errorKbn,
          level: finish.errorKbn ? 'WARN' : 'INFO',
        });
        return finish;
      }
      await ctx.refreshEvent();
    }
    return { statusKbn: WebhookStatusKbn.PROCESSED };
  }
}
