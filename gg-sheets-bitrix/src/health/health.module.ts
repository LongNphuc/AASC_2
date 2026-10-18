import { Module } from '@nestjs/common';
import { HealthController } from './controllers/health.controller';

/** GET /health: ứng dụng và DB còn chạy (Docker HEALTHCHECK). */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
