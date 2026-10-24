import { getQueueToken } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { BITRIX_STATUS_KEY } from '../../bitrix/clients/bitrix24.client';
import { REDIS } from '../../common/redis/redis.module';
import { appConfig, type AppConfig } from '../../config/app-config';
import { QUEUE } from '../../queues/queue-names';
import { heartbeatAgeSeconds } from '../../queues/services/worker-heartbeat.service';

/**
 * Các chỉ báo của /health (readme_api.md mục 8). Redis down làm health đỏ
 * (503); worker, Bitrix24 down chỉ là "degraded" (vẫn 200), để Docker không
 * khởi động lại api chỉ vì Bitrix24 hoặc worker lỗi; job ở dead letter queue
 * chỉ hiện số.
 */
@Injectable()
export class HealthIndicators {
  constructor(
    private readonly indicators: HealthIndicatorService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(getQueueToken(QUEUE.CRM_PIPELINE)) private readonly pipeline: Queue,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  redisPing() {
    return this.indicators
      .check('redis')
      .attempt(async () => {
        await this.redis.ping();
      })
      .withTimeout(3000);
  }

  /** Nhịp tim worker trong Redis còn mới (worker ghi mỗi WORKER_HEARTBEAT_SECONDS). */
  async worker() {
    const session = this.indicators.check('worker');
    const age = await heartbeatAgeSeconds(this.redis).catch(() => null);
    return age !== null && age <= this.config.queue.workerStaleSeconds
      ? session.up({ heartbeatAgeSeconds: age })
      : session.degraded({ down: true, heartbeatAgeSeconds: age });
  }

  /** Số job chờ, số job lỗi ở dead letter queue: báo, không làm health đỏ. */
  async queues() {
    const session = this.indicators.check('queues');
    try {
      const counts = await this.pipeline.getJobCounts(
        'waiting',
        'prioritized',
        'active',
        'delayed',
        'failed',
      );
      return session.up({
        waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
      });
    } catch {
      return session.degraded({ down: true });
    }
  }

  /**
   * Bitrix24: chế độ CRM (worker kiểm khi khởi động) và lần gọi thành công gần
   * nhất (Bitrix24Client ghi vào Redis). Chế độ đơn giản thì down (40012).
   */
  async bitrix24() {
    const session = this.indicators.check('bitrix24');
    const status = await this.redis
      .hgetall(BITRIX_STATUS_KEY)
      .catch((): Record<string, string> => ({}));
    const lastSuccessAgeSeconds = status.lastSuccessAt
      ? Math.round((Date.now() - Number(status.lastSuccessAt)) / 1000)
      : null;
    const data = { mode: status.mode ?? 'unknown', lastSuccessAgeSeconds };
    return status.mode === 'simple'
      ? session.degraded({ down: true, errorKbn: 40012, ...data })
      : session.up(data);
  }
}
