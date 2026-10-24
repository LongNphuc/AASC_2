import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../analytics/alerts.module';
import { LeadSubmission } from '../leads/entities/lead-submission.entity';
import { WebhookEvent } from '../webhooks/entities/webhook-event.entity';
import { TiktokEventsClient } from './clients/tiktok-events.client';
import { ConversionEvent } from './entities/conversion-event.entity';
import { ConversionService } from './services/conversion.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversionEvent, LeadSubmission, WebhookEvent]),
    AlertsModule,
  ],
  providers: [ConversionService, TiktokEventsClient],
  exports: [ConversionService],
})
export class ConversionsModule {}
