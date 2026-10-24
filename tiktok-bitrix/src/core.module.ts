import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from './common/redis/redis.module';
import { appConfig, type AppConfig } from './config/app-config';
import { dataSourceOptions } from './database/data-source';
import { OpsModule } from './queues/ops.module';
import { QueuesModule } from './queues/queues.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BitrixModule } from './bitrix/bitrix.module';
import { ConfigurationsModule } from './configurations/configurations.module';
import { DealsModule } from './deals/deals.module';
import { HealthModule } from './health/health.module';
import { LeadsApiModule } from './leads/leads-api.module';
import { LeadsModule } from './leads/leads.module';
import { WebhooksModule } from './webhooks/webhooks.module';

export interface CoreModuleOptions {
  /** Chỉ process api chạy migration khi khởi động (DB_MIGRATIONS_RUN). */
  runMigrations: boolean;
}

/**
 * Phần dùng chung cho api và worker: cấu hình, TypeORM, Redis, đăng ký queue
 * và các module nghiệp vụ. Không có processor nào ở đây: processor nằm trong
 * WorkerModule, nên process api không bao giờ chạy job.
 */
@Module({})
export class CoreModule {
  static forRoot(options: CoreModuleOptions): DynamicModule {
    const shared = [
      TypeOrmModule.forRootAsync({
        inject: [appConfig.KEY],
        useFactory: (config: AppConfig) => ({
          ...dataSourceOptions(config.databaseUrl),
          // Entity khai báo qua forFeature của từng module; bảng tạo bằng migration.
          entities: [],
          autoLoadEntities: true,
          migrationsRun: options.runMigrations && config.migrationsRun,
          migrationsTransactionMode: 'each' as const,
        }),
      }),
      RedisModule,
      QueuesModule,
    ];
    const business = [
      WebhooksModule,
      BitrixModule,
      ConfigurationsModule,
      LeadsModule,
      LeadsApiModule,
      DealsModule,
      AnalyticsModule,
      OpsModule,
      HealthModule,
    ];
    return {
      module: CoreModule,
      imports: [
        // Toàn cục: không cần export.
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          load: [appConfig],
        }),
        ...shared,
        ...business,
      ],
      exports: [...shared, ...business],
    };
  }
}
