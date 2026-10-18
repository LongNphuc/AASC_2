import {
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin/admin.module';
import { BitrixModule } from './bitrix/bitrix.module';
import { ApiKeyGuard } from './common/auth/api-key.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestLoggingMiddleware } from './common/logging/request-logging.middleware';
import { validationExceptionFactory } from './common/validation/validation-exception.factory';
import { appConfig, type AppConfig } from './config/app-config';
import { dataSourceOptions } from './database/data-source';
import { GoogleModule } from './google/google.module';
import { HealthModule } from './health/health.module';
import { LeadsModule } from './leads/leads.module';
import { MappingModule } from './mapping/mapping.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, load: [appConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (config: AppConfig) => ({
        ...dataSourceOptions(config.databaseUrl),
        // Entity khai báo qua forFeature của từng module; bảng tạo bằng migration.
        entities: [],
        autoLoadEntities: true,
        migrationsRun: true,
      }),
    }),
    ScheduleModule.forRoot(),
    GoogleModule,
    BitrixModule,
    MappingModule,
    LeadsModule,
    SyncModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    // Đăng ký toàn cục qua DI (thay vì trong main.ts) để e2e test cũng có.
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('{*splat}');
  }
}
