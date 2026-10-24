import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { appConfig, type AppConfig } from '../config/app-config';
import { QUEUE } from './queue-names';
import { PipelineQueueService } from './services/pipeline-queue.service';

/**
 * Đăng ký hai queue crm-pipeline, maintenance (chỉ bên đẩy job; processor
 * nằm trong WorkerModule, nên process api không bao giờ chạy job).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (config: AppConfig) => ({
        connection: { url: config.redisUrl, maxRetriesPerRequest: null },
      }),
    }),
    ...[QUEUE.CRM_PIPELINE, QUEUE.MAINTENANCE].map((name) =>
      BullModule.registerQueueAsync({
        name,
        inject: [appConfig.KEY],
        useFactory: (config: AppConfig) => ({
          // Như BullMQ khuyên cho bên đẩy job (Going to production): báo lỗi
          // ngay khi Redis sập thay vì xếp lệnh chờ trong bộ nhớ.
          connection: { url: config.redisUrl, enableOfflineQueue: false },
        }),
      }),
    ),
  ],
  providers: [PipelineQueueService],
  exports: [BullModule, PipelineQueueService],
})
export class QueuesModule {}
