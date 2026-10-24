import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { appConfig, type AppConfig } from '../../config/app-config';

/** Kết nối ioredis dùng chung: cache, limiter Bitrix24, throttler, nhịp tim worker. */
export const REDIS = Symbol('REDIS');

/**
 * Kết nối báo lỗi ngay khi Redis sập (enableOfflineQueue: false), thay vì
 * treo request: webhook trả 500 và TikTok gửi lại (readme_design.md mục 3.2).
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [appConfig.KEY],
      useFactory: async (config: AppConfig) => {
        const redis = new Redis(config.redisUrl, {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });
        await redis.connect();
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
