import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ERROR, LOG, WARN } from './common/constants/messages.constant';
import { AppLogger } from './common/logging/app-logger.service';
import { logFiles } from './common/logging/log-files';
import { appConfig, AppConfig, findMissingSettings } from './config/app-config';
import { DEFAULT_LOG_DIR } from './config/env.validation';
import { loadEnvFileIfPresent } from './config/load-env-file';
import { setupSwagger } from './config/swagger';

// Mở tệp log trước khi Nest khởi tạo, để lỗi khởi động cũng vào app.log.
loadEnvFileIfPresent();
logFiles.configure(process.env.LOG_DIR || DEFAULT_LOG_DIR);
const logger = new AppLogger('Bootstrap');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger,
    abortOnError: false,
  });
  const config = app.get<AppConfig>(appConfig.KEY);
  setupSwagger(app);
  await app.listen(config.port);

  logger.log(LOG.BOOTSTRAP.LISTENING(config.port));
  logger.log(LOG.BOOTSTRAP.LINKS(config.port));
  for (const name of findMissingSettings(config)) {
    logger.warn(WARN.BOOTSTRAP.MISSING_SETTING(name));
  }
  if (!config.apiKey) logger.warn(WARN.BOOTSTRAP.API_OPEN);
}

/** Khởi động thất bại: ghi lý do vào app.log, chờ ghi xong rồi thoát với mã 1. */
bootstrap().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(ERROR.SYSTEM.STARTUP_FAILED(message));
  await logFiles.close();
  process.exit(1);
});
