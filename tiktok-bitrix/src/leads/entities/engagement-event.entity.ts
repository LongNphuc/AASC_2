import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Bảng engagement_events: một tương tác user.interaction (readme_design.md mục 4.6). */
@Entity({ name: 'engagement_events' })
export class EngagementEvent {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  @Column({ name: 'webhook_event_uuid', type: 'uuid' })
  webhookEventUuid: string;

  @Column({ name: 'advertiser_id', type: 'varchar', nullable: true })
  advertiserId: string | null;

  @Column({ name: 'campaign_id', type: 'varchar', nullable: true })
  campaignId: string | null;

  @Column({ name: 'ad_id', type: 'varchar', nullable: true })
  adId: string | null;

  @Column({ name: 'form_id', type: 'varchar', nullable: true })
  formId: string | null;

  /** ad_click hoặc form_open. */
  @Column({ name: 'interaction_type', type: 'varchar', length: 50 })
  interactionType: string;

  @Column({ type: 'varchar', nullable: true })
  ttclid: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
