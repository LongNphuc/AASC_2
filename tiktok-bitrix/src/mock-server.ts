import { NestFactory } from '@nestjs/core';
import { ERROR, LOG } from './common/constants/messages.constant';
import { AppLogger } from './common/logging/app-logger.service';
import { logFiles } from './common/logging/log-files';
import { DEFAULT_LOG_DIR } from './config/env.validation';
import { loadEnvFileIfPresent } from './config/load-env-file';
import { mockConfigFromEnv } from './mock/mock-config';
import { MockModule } from './mock/mock.module';

loadEnvFileIfPresent();
logFiles.configure(process.env.LOG_DIR || DEFAULT_LOG_DIR, 'mock');
const logger = new AppLogger('MockServer');

/** Process mock: Bitrix24 REST và TikTok Events API giả, cổng MOCK_PORT. */
async function bootstrap(): Promise<void> {
  const config = mockConfigFromEnv();
  const app = await NestFactory.create(MockModule.forRoot(config), {
    logger: ['error', 'warn'],
  });
  app.enableShutdownHooks();
  await app.listen(config.port);
  logger.log(LOG.BOOTSTRAP.MOCK_LISTENING(config.port));
}

bootstrap().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(ERROR.SYSTEM.STARTUP_FAILED(message));
  await logFiles.close();
  process.exit(1);
});
