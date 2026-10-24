import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { QueuesModule } from '../queues/queues.module';
import { HealthController } from './controllers/health.controller';
import { HealthIndicators } from './indicators/health.indicators';

@Module({
  imports: [TerminusModule, QueuesModule],
  controllers: [HealthController],
  providers: [HealthIndicators],
})
export class HealthModule {}
