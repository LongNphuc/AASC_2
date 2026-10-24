import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueuesModule } from '../queues/queues.module';
import { WebhookEvent } from '../webhooks/entities/webhook-event.entity';
import { Import } from './entities/import.entity';
import { HistoryImportService } from './services/history-import.service';

@Module({
  imports: [TypeOrmModule.forFeature([Import, WebhookEvent]), QueuesModule],
  providers: [HistoryImportService],
  exports: [HistoryImportService],
})
export class ImportsModule {}
