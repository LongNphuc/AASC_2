import { getQueueToken } from '@nestjs/bullmq';
import { NestFactory } from '@nestjs/core';
import type { Queue } from 'bullmq';
import { BitrixMetadataService } from './bitrix/services/bitrix-metadata.service';
import { ERROR, LOG } from './common/constants/messages.constant';
import { AppLogger, logLevelsFor } from './common/logging/app-logger.service';
import { logFiles } from './common/logging/log-files';
import { DEFAULT_LOG_DIR } from './config/env.validation';
import { loadEnvFileIfPresent } from './config/load-env-file';
import { QUEUE } from './queues/queue-names';
import { WorkerModule } from './worker.module';

loadEnvFileIfPresent();
logFiles.configure(process.env.LOG_DIR || DEFAULT_LOG_DIR, 'worker');
const logger = new AppLogger('Worker');
logger.setLogLevels(logLevelsFor(process.env.LOG_LEVEL ?? 'info'));

/**
 * Process worker (readme_design.md mục 1): chạy job của crm-pipeline lần lượt
 * từng job một và các job định kỳ. Luôn chỉ một process; SIGTERM thì chờ job
 * đang chạy xong rồi thoát (app.close đóng worker BullMQ).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger,
    abortOnError: false,
  });
  app.enableShutdownHooks();
  // Cả queue chỉ chạy một job mỗi lúc; vẫn phải chạy một process worker (mục 10.1).
  const pipeline = app.get<Queue>(getQueueToken(QUEUE.CRM_PIPELINE));
  await pipeline.setGlobalConcurrency(1);
  try {
    await app.get(BitrixMetadataService).checkCrmMode();
  } catch (error) {
    logger.warn(error instanceof Error ? error.message : String(error));
  }
  logger.log(
    LOG.BOOTSTRAP.WORKER_READY(`${QUEUE.CRM_PIPELINE} (global concurrency 1)`),
  );
}

bootstrap().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(ERROR.SYSTEM.STARTUP_FAILED(message));
  await logFiles.close();
  process.exit(1);
});
