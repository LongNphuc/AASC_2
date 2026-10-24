import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TiktokBriefAdapter } from './adapters/tiktok-brief.adapter';
import { EngagementEvent } from './entities/engagement-event.entity';
import { Lead } from './entities/lead.entity';
import { LeadSubmission } from './entities/lead-submission.entity';
import { EngagementService } from './services/engagement.service';
import { FormCompletionService } from './services/form-completion.service';
import { LeadDedupeService } from './services/lead-dedupe.service';
import { LeadEventNormalizer } from './services/lead-event-normalizer.service';
import { LeadIngestService } from './services/lead-ingest.service';
import { LeadMergeService } from './services/lead-merge.service';
import { QualityScoreService } from './services/quality-score.service';

/** Module 1: chuẩn hóa, validate, chống trùng, gộp, chấm điểm (readme_design.md mục 4). */
@Module({
  imports: [TypeOrmModule.forFeature([Lead, LeadSubmission, EngagementEvent])],
  providers: [
    TiktokBriefAdapter,
    LeadEventNormalizer,
    LeadDedupeService,
    LeadMergeService,
    FormCompletionService,
    QualityScoreService,
    EngagementService,
    LeadIngestService,
  ],
  exports: [
    TypeOrmModule,
    LeadEventNormalizer,
    LeadIngestService,
    EngagementService,
    QualityScoreService,
  ],
})
export class LeadsModule {}
