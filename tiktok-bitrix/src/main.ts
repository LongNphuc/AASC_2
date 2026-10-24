import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiModule } from './api.module';
import { ERROR, LOG, WARN } from './common/constants/messages.constant';
import { AppLogger, logLevelsFor } from './common/logging/app-logger.service';
import { logFiles } from './common/logging/log-files';
import { appConfig, type AppConfig } from './config/app-config';
import { DEFAULT_LOG_DIR } from './config/env.validation';
import { loadEnvFileIfPresent } from './config/load-env-file';
import { setupSwagger } from './config/swagger';

// Mở tệp log trước khi Nest khởi tạo, để lỗi khởi động cũng vào app.log.
loadEnvFileIfPresent();
logFiles.configure(process.env.LOG_DIR || DEFAULT_LOG_DIR, 'api');
const logger = new AppLogger('Bootstrap');
logger.setLogLevels(logLevelsFor(process.env.LOG_LEVEL ?? 'info'));

/** Process api: webhook, API quản lý, Swagger, /health (readme_design.md mục 1). */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
    logger,
    bodyParser: false,
    abortOnError: false,
  });
  const config = app.get<AppConfig>(appConfig.KEY);
  // Sau reverse proxy / mạng Docker: đọc IP thật từ X-Forwarded-For cho throttler.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.enableShutdownHooks();
  setupSwagger(app);
  await app.listen(config.port);

  logger.log(LOG.BOOTSTRAP.LISTENING(config.port));
  if (!config.apiKey) logger.warn(WARN.BOOTSTRAP.API_OPEN);
}

/** Khởi động thất bại: ghi lý do vào app.log, chờ ghi xong rồi thoát với mã 1. */
bootstrap().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(ERROR.SYSTEM.STARTUP_FAILED(message));
  await logFiles.close();
  process.exit(1);
});
