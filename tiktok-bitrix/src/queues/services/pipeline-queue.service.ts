import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { appConfig, type AppConfig } from '../../config/app-config';
import {
  jobIdFor,
  jobNameFor,
  pipelineJobOptions,
  type PipelineEventRef,
} from '../job-options';
import { QUEUE, type PipelineJobData } from '../queue-names';

/** Kết quả đẩy lại job của một sự kiện chưa xong. */
export type RequeueAction = 'retried' | 'readded' | 'skipped';

/** Trạng thái job còn đang chờ hoặc đang chạy: không đụng tới. */
const PENDING_STATES = new Set([
  'waiting',
  'delayed',
  'active',
  'prioritized',
  'waiting-children',
]);

/**
 * Bên đẩy job vào queue crm-pipeline: webhook, chuyển tay, import, recovery.
 * Kết nối Redis của queue đặt enableOfflineQueue: false (queues.module.ts):
 * Redis sập thì lệnh đẩy báo lỗi ngay, request trả 500 thay vì treo.
 */
@Injectable()
export class PipelineQueueService {
  constructor(
    @InjectQueue(QUEUE.CRM_PIPELINE)
    private readonly queue: Queue<PipelineJobData>,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async enqueue(event: PipelineEventRef): Promise<void> {
    await this.queue.add(
      jobNameFor(event),
      { webhookEventUuid: event.uuid },
      pipelineJobOptions(
        event,
        this.config.queue.attempts,
        this.config.queue.backoffMs,
      ),
    );
  }

  /**
   * Đẩy lại job của sự kiện chưa xong (webhook gửi lại, batch recovery,
   * readme_design.md mục 3.2, 10.3). queue.add với jobId còn nằm trong tập
   * failed không làm gì, nên phải tự chọn cách theo trạng thái job:
   *
   *   failed (dead letter queue) → job.retry, đặt lại số lần thử
   *   không có (Redis mất, job đã bị dọn), hoặc đã xong mà sự kiện chưa xong
   *                              → thêm lại với đúng jobId cũ
   *   đang chờ, đang chạy        → bỏ qua
   */
  async requeue(event: PipelineEventRef): Promise<RequeueAction> {
    const job = await this.queue.getJob(jobIdFor(event));
    const state = job ? await job.getState() : 'missing';
    if (PENDING_STATES.has(state)) return 'skipped';
    if (job && state === 'failed') {
      await job.retry('failed', { resetAttemptsMade: true });
      return 'retried';
    }
    if (job) await job.remove().catch(() => undefined);
    await this.enqueue(event);
    return 'readded';
  }

  get pipeline(): Queue<PipelineJobData> {
    return this.queue;
  }
}
