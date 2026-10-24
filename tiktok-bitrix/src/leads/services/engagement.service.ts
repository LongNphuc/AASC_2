import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { WebhookEvent } from '../../webhooks/entities/webhook-event.entity';
import { EngagementEvent } from '../entities/engagement-event.entity';
import type { NormalizedInteraction } from '../types/lead-event.types';

/**
 * user.interaction không có thông tin cá nhân nên không gắn được với một
 * khách: chỉ ghi engagement_events, dùng cho điểm chất lượng (cùng ttclid) và
 * phễu ở Module 3 (readme_design.md mục 4.6).
 */
@Injectable()
export class EngagementService {
  async record(
    manager: EntityManager,
    webhookEvent: WebhookEvent,
    interaction: NormalizedInteraction,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(EngagementEvent)
      .values({
        webhookEventUuid: webhookEvent.uuid,
        advertiserId: interaction.advertiser_id ?? null,
        campaignId: interaction.campaign_id ?? null,
        adId: interaction.ad_id ?? null,
        formId: interaction.form_id ?? null,
        interactionType: interaction.type,
        ttclid: interaction.ttclid ?? null,
        occurredAt: new Date(interaction.timestamp * 1000),
      })
      .orIgnore()
      .execute();
  }

  /** Số tương tác cùng ttclid xảy ra trước (hoặc cùng lúc) thời điểm gửi form. */
  async countBefore(
    manager: EntityManager,
    ttclid: string | null | undefined,
    before: Date,
  ): Promise<number> {
    if (!ttclid) return 0;
    const rows = await manager.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM engagement_events WHERE ttclid = $1 AND occurred_at <= $2`,
      [ttclid, before],
    );
    return rows[0]?.count ?? 0;
  }
}
