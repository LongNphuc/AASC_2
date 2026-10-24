import {
  MiddlewareConsumer,
  Module,
  NestModule,
  OnApplicationBootstrap,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { json, raw, urlencoded } from 'express';
import type Redis from 'ioredis';
import { ApiKeyGuard } from './common/auth/api-key.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { RequestContextMiddleware } from './common/logging/request-log';
import { REDIS } from './common/redis/redis.module';
import {
  AppThrottlerGuard,
  THROTTLER,
  throttlerApplies,
} from './common/throttler/app-throttler.guard';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { validationExceptionFactory } from './common/validation/validation-exception.factory';
import { appConfig, type AppConfig } from './config/app-config';
import { WorkerWatchdogService } from './analytics/services/worker-watchdog.service';
import { AlertsModule } from './analytics/alerts.module';
import { ConfigurationService } from './configurations/services/configuration.service';
import { CoreModule } from './core.module';

/** Đường dẫn webhook TikTok: body đọc dạng Buffer để kiểm chữ ký trên raw body. */
const TIKTOK_WEBHOOK_ROUTE = {
  path: 'webhooks/tiktok/leads',
  method: RequestMethod.POST,
};
const BODY_LIMIT = '1mb';

/**
 * Process api: CoreModule + controller; guard API key, throttler, filter lỗi,
 * ValidationPipe, interceptor ghi log toàn cục; chạy migration khi khởi động.
 */
@Module({
  imports: [
    CoreModule.forRoot({ runMigrations: true }),
    AlertsModule,
    ThrottlerModule.forRootAsync({
      inject: [appConfig.KEY, REDIS],
      useFactory: (config: AppConfig, redis: Redis) => {
        const ttl = config.throttle.ttlSeconds * 1000;
        const limits: Record<string, number> = {
          [THROTTLER.API]: config.throttle.apiLimit,
          [THROTTLER.EXPORT]: config.throttle.exportLimit,
          [THROTTLER.WEBHOOK]: config.throttle.webhookLimit,
        };
        return {
          throttlers: Object.entries(limits).map(([name, limit]) => ({
            name,
            ttl,
            limit,
            skipIf: (context) =>
              !throttlerApplies(
                name,
                context.switchToHttp().getRequest<{ path: string }>().path,
              ),
          })),
          storage: new RedisThrottlerStorage(redis),
        };
      },
    }),
  ],
  providers: [
    // Chỉ chạy trong api: worker chết thì không tự báo được (mục 9.8).
    WorkerWatchdogService,
    // Đăng ký toàn cục qua DI (thay vì trong main.ts) để test cũng có.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        stopAtFirstError: true,
        exceptionFactory: validationExceptionFactory,
      }),
    },
  ],
})
export class ApiModule implements NestModule, OnApplicationBootstrap {
  constructor(private readonly configurations: ConfigurationService) {}

  /** Lần khởi động đầu (sau migration): nạp cấu hình mặc định nếu bảng trống. */
  async onApplicationBootstrap(): Promise<void> {
    await this.configurations.loadDefaultsIfEmpty();
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('{*splat}');
    // Ứng dụng tạo với bodyParser: false (main.ts) và tự gắn bộ đọc body:
    // webhook TikTok giữ nguyên byte để kiểm chữ ký rồi mới parse JSON; các
    // đường dẫn khác đọc JSON và form-urlencoded (webhook Bitrix24).
    consumer
      .apply(raw({ type: () => true, limit: BODY_LIMIT }))
      .forRoutes(TIKTOK_WEBHOOK_ROUTE);
    consumer
      .apply(
        json({ limit: BODY_LIMIT }),
        urlencoded({ extended: true, limit: BODY_LIMIT }),
      )
      .exclude(TIKTOK_WEBHOOK_ROUTE)
      .forRoutes('{*splat}');
  }
}
