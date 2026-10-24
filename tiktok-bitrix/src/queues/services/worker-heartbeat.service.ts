import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { hostname } from 'node:os';
import { REDIS } from '../../common/redis/redis.module';
import { appConfig, type AppConfig } from '../../config/app-config';

export const HEARTBEAT_PREFIX = 'worker:heartbeat:';

/**
 * Worker không mở cổng HTTP nên không có /health riêng: ghi nhịp tim vào Redis
 * mỗi WORKER_HEARTBEAT_SECONDS; /health của api đọc và báo worker down khi
 * nhịp tim cũ hơn WORKER_STALE_SECONDS (readme_improvements.md mục 1).
 */
@Injectable()
export class WorkerHeartbeatService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private readonly key = `${HEARTBEAT_PREFIX}${hostname()}`;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    void this.beat();
    this.timer = setInterval(
      () => void this.beat(),
      this.config.queue.workerHeartbeatSeconds * 1000,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.redis.del(this.key).catch(() => undefined);
  }

  private async beat(): Promise<void> {
    await this.redis
      .set(this.key, Date.now(), 'EX', this.config.queue.workerStaleSeconds)
      .catch(() => undefined);
  }
}

/** Tuổi (giây) của nhịp tim mới nhất trong mọi worker; null nếu không có. */
export async function heartbeatAgeSeconds(
  redis: Redis,
): Promise<number | null> {
  const keys = await redis.keys(`${HEARTBEAT_PREFIX}*`);
  if (keys.length === 0) return null;
  const values = await redis.mget(...keys);
  const latest = Math.max(...values.map((v) => Number(v ?? 0)));
  return latest ? Math.round((Date.now() - latest) / 1000) : null;
}
