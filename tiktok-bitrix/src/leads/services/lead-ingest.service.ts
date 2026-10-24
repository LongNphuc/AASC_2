import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { LeadStatusKbn, StatusKbn } from '../../common/kbn/status.kbn';
import { EventTypeKbn } from '../../common/kbn/type.kbn';
import { WebhookEvent } from '../../webhooks/entities/webhook-event.entity';
import { Lead } from '../entities/lead.entity';
import {
  LeadSubmission,
  type SubmissionWarning,
} from '../entities/lead-submission.entity';
import type { NormalizedLeadEvent } from '../types/lead-event.types';
import { EngagementService } from './engagement.service';
import { FormCompletionService } from './form-completion.service';
import { LeadDedupeService } from './lead-dedupe.service';
import {
  answersOf,
  customerDataOf,
  LeadMergeService,
  mergeAnswers,
  type CustomerData,
} from './lead-merge.service';
import { QualityScoreService } from './quality-score.service';

export interface IngestResult {
  leadUuid: string;
  submissionUuid: string;
  /** Khách mới tạo trong lần này. */
  newLead: boolean;
  /** form.complete cập nhật lượt gửi cũ thay vì tạo lượt gửi mới. */
  completedExisting: boolean;
}

/**
 * Bước 2 của job tiktok-event (readme_design.md mục 4.4): trong transaction
 * của bước, tìm khách, gộp dữ liệu, tạo hoặc cập nhật lượt gửi, ghi
 * webhook_events.lead_submission_uuid. Chỉ ghi DB, nên chạy đúng một lần nhờ
 * current_step_kbn ghi cùng transaction (mục 10.5).
 */
@Injectable()
export class LeadIngestService {
  constructor(
    private readonly dedupe: LeadDedupeService,
    private readonly merger: LeadMergeService,
    private readonly formCompletion: FormCompletionService,
    private readonly engagement: EngagementService,
    private readonly scorer: QualityScoreService,
  ) {}

  async ingest(
    manager: EntityManager,
    webhookEvent: WebhookEvent,
    event: NormalizedLeadEvent,
    warnings: SubmissionWarning[],
  ): Promise<IngestResult> {
    const submittedAt = new Date(event.timestamp * 1000);
    const data = customerDataOf(event);
    const existingUuid = await this.dedupe.findExistingLead(
      manager,
      data.email,
      data.phone,
    );
    const lead = existingUuid
      ? await manager.findOneByOrFail(Lead, { uuid: existingUuid })
      : null;
    const interactionCount = await this.engagement.countBefore(
      manager,
      event.lead_data.ttclid,
      submittedAt,
    );

    if (event.event === 'form.complete' && lead) {
      const open = await this.formCompletion.findOpenSubmission(
        manager,
        lead.uuid,
        event.form.form_id,
        submittedAt,
      );
      if (open) {
        await this.completeSubmission(
          manager,
          open,
          event,
          data,
          warnings,
          interactionCount,
        );
        await this.saveLead(manager, lead, data, submittedAt);
        await manager.update(
          WebhookEvent,
          { uuid: webhookEvent.uuid },
          { leadSubmissionUuid: open.uuid },
        );
        return {
          leadUuid: lead.uuid,
          submissionUuid: open.uuid,
          newLead: false,
          completedExisting: true,
        };
      }
    }

    const leadUuid = await this.saveLead(manager, lead, data, submittedAt);
    const submissionUuid = randomUUID();
    const answers = answersOf(event);
    const isComplete = event.event === 'form.complete';
    await manager.insert(LeadSubmission, {
      uuid: submissionUuid,
      leadUuid,
      webhookEventUuid: webhookEvent.uuid,
      channelKbn: event.channelKbn,
      eventTypeKbn: isComplete
        ? EventTypeKbn.FORM_COMPLETE
        : EventTypeKbn.LEAD_GENERATE,
      externalId: event.event_id,
      advertiserId: event.advertiser_id ?? null,
      campaignId: event.campaign.campaign_id ?? null,
      campaignName: event.campaign.campaign_name ?? null,
      adId: event.campaign.ad_id ?? null,
      adName: event.campaign.ad_name ?? null,
      formId: event.form.form_id ?? null,
      formName: event.form.form_name ?? null,
      name: data.name,
      email: data.email,
      phone: data.phone,
      city: data.city,
      interests: event.lead_data.interests ?? null,
      answers,
      utmSource: event.lead_data.utm_source ?? null,
      utmCampaign: event.lead_data.utm_campaign ?? null,
      ttclid: event.lead_data.ttclid ?? null,
      qualityScore: this.scorer.score({
        email: data.email,
        phone: data.phone,
        answers,
        interactionCount,
      }),
      warnings,
      syncStatusKbn: StatusKbn.PENDING,
      completedAt: isComplete ? submittedAt : null,
      submittedAt,
    });
    await manager.update(
      WebhookEvent,
      { uuid: webhookEvent.uuid },
      { leadSubmissionUuid: submissionUuid },
    );
    return {
      leadUuid,
      submissionUuid,
      newLead: !lead,
      completedExisting: false,
    };
  }

  /**
   * form.complete cập nhật lượt gửi trước đó: câu trả lời, dữ liệu khách, điểm,
   * completed_at; đặt lại PENDING để các bước sau đẩy dữ liệu mới. Giữ nguyên
   * event_type_kbn để thống kê theo loại sự kiện không lệch.
   */
  private async completeSubmission(
    manager: EntityManager,
    open: LeadSubmission,
    event: NormalizedLeadEvent,
    data: CustomerData,
    warnings: SubmissionWarning[],
    interactionCount: number,
  ): Promise<void> {
    const answers = mergeAnswers(open.answers, answersOf(event));
    const email = data.email ?? open.email;
    const phone = data.phone ?? open.phone;
    await manager.update(
      LeadSubmission,
      { uuid: open.uuid },
      {
        name: data.name || open.name,
        email,
        phone,
        city: data.city ?? open.city,
        interests: event.lead_data.interests ?? open.interests,
        utmSource: event.lead_data.utm_source ?? open.utmSource,
        utmCampaign: event.lead_data.utm_campaign ?? open.utmCampaign,
        ttclid: event.lead_data.ttclid ?? open.ttclid,
        answers,
        qualityScore: this.scorer.score({
          email,
          phone,
          answers,
          interactionCount,
        }),
        completedAt: new Date(event.timestamp * 1000),
        syncStatusKbn: StatusKbn.PENDING,
        warnings: [...open.warnings, ...warnings],
        updatedAt: new Date(),
      },
    );
  }

  /** Tạo khách mới hoặc gộp vào khách có sẵn; trả uuid của khách. */
  private async saveLead(
    manager: EntityManager,
    lead: Lead | null,
    data: CustomerData,
    submittedAt: Date,
  ): Promise<string> {
    const merged = this.merger.merge(lead, data, submittedAt);
    if (!lead) {
      const uuid = randomUUID();
      await manager.insert(Lead, {
        uuid,
        ...merged,
        statusKbn: LeadStatusKbn.NEW,
      });
      return uuid;
    }
    await manager.update(
      Lead,
      { uuid: lead.uuid },
      { ...merged, updatedAt: new Date() },
    );
    return lead.uuid;
  }
}
