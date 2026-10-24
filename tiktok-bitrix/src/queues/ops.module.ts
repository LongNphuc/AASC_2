import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookEvent } from '../webhooks/entities/webhook-event.entity';
import { OpsController } from './controllers/ops.controller';
import { QueuesModule } from './queues.module';
import { DeadLetterService } from './services/dead-letter.service';
import { RecoveryService } from './services/recovery.service';

/** Vận hành hàng đợi: số job, dead letter queue, batch recovery (readme_design.md mục 10). */
@Module({
  imports: [TypeOrmModule.forFeature([WebhookEvent]), QueuesModule],
  controllers: [OpsController],
  providers: [DeadLetterService, RecoveryService],
  exports: [RecoveryService],
})
export class OpsModule {}
