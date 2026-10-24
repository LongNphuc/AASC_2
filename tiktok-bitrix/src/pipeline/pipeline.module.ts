import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../analytics/alerts.module';
import { ConversionsModule } from '../conversions/conversions.module';
import { DealsModule } from '../deals/deals.module';
import { LeadSyncModule } from '../lead-sync/lead-sync.module';
import { LeadsModule } from '../leads/leads.module';
import { LeadSubmission } from '../leads/entities/lead-submission.entity';
import { WebhookEvent } from '../webhooks/entities/webhook-event.entity';
import { BitrixDealEventJob } from './jobs/bitrix-deal-event.job';
import { ConvertDealJob } from './jobs/convert-deal.job';
import { DealSteps } from './jobs/deal-steps';
import { StepRunner } from './jobs/step-runner';
import { TiktokEventJob } from './jobs/tiktok-event.job';
import { CrmPipelineProcessor } from './processors/crm-pipeline.processor';

/** Các bước của từng loại job và processor của queue crm-pipeline (chỉ nạp trong WorkerModule). */
@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEvent, LeadSubmission]),
    LeadsModule,
    LeadSyncModule,
    DealsModule,
    ConversionsModule,
    AlertsModule,
  ],
  providers: [
    StepRunner,
    TiktokEventJob,
    BitrixDealEventJob,
    ConvertDealJob,
    DealSteps,
    CrmPipelineProcessor,
  ],
})
export class PipelineModule {}
