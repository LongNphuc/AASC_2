import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { ALERT } from '../../common/constants/messages.constant';
import { AlertTypeKbn } from '../../common/kbn/type.kbn';
import { REDIS } from '../../common/redis/redis.module';
import { appConfig, type AppConfig } from '../../config/app-config';
import { heartbeatAgeSeconds } from '../../queues/services/worker-heartbeat.service';
import { AlertService } from './alert.service';

const CHECK_INTERVAL_MS = 60_000;

/**
 * Chạy trong api: nhịp tim worker cũ hơn WORKER_STALE_SECONDS thì tạo cảnh báo
 * WORKER_DOWN. Do api kiểm vì worker chết thì không tự báo được (mục 9.8).
 */
@Injectable()
export class WorkerWatchdogService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly alerts: AlertService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.env === 'test') return;
    this.timer = setInterval(
      () => void this.check().catch(() => undefined),
      CHECK_INTERVAL_MS,
    );
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async check(): Promise<boolean> {
    const age = await heartbeatAgeSeconds(this.redis);
    if (age !== null && age <= this.config.queue.workerStaleSeconds)
      return false;
    await this.alerts.raise(
      AlertTypeKbn.WORKER_DOWN,
      'worker',
      ALERT.WORKER_DOWN(age),
      { heartbeatAgeSeconds: age },
    );
    return true;
  }
}
