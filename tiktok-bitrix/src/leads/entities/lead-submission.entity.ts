import type { JsonObject } from '../../database/json';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Một câu hỏi bổ sung của form và câu trả lời. */
export interface SubmissionAnswer {
  question: string;
  /** Khóa dùng trong rule: answers.<slug>. */
  slug: string;
  answer: string;
}

/** Cảnh báo ghi trên lượt gửi: giá trị bị bỏ, comment bị từ chối, lead nghi trùng. */
export interface SubmissionWarning {
  code: string;
  message: string;
  at: string;
}

/** Bảng lead_submissions: một lần khách gửi form (readme_design.md mục 11.2). */
@Entity({ name: 'lead_submissions' })
export class LeadSubmission {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  @Column({ name: 'lead_uuid', type: 'uuid' })
  leadUuid: string;

  /** Sự kiện đã tạo ra lượt gửi. */
  @Column({ name: 'webhook_event_uuid', type: 'uuid' })
  webhookEventUuid: string;

  /** Deal mà lượt gửi tạo ra hoặc được gắn vào. */
  @Column({ name: 'deal_uuid', type: 'uuid', nullable: true })
  dealUuid: string | null;

  @Column({ name: 'channel_kbn', type: 'integer' })
  channelKbn: number;

  /** Loại sự kiện đã tạo ra lượt gửi (LEAD_GENERATE, FORM_COMPLETE). */
  @Column({ name: 'event_type_kbn', type: 'integer' })
  eventTypeKbn: number;

  /** ID lead phía TikTok (payload của đề: event_id); dùng khi báo conversion. */
  @Column({ name: 'external_id', type: 'varchar', length: 255 })
  externalId: string;

  @Column({ name: 'advertiser_id', type: 'varchar', nullable: true })
  advertiserId: string | null;

  @Column({ name: 'campaign_id', type: 'varchar', nullable: true })
  campaignId: string | null;

  @Column({ name: 'campaign_name', type: 'varchar', nullable: true })
  campaignName: string | null;

  @Column({ name: 'ad_id', type: 'varchar', nullable: true })
  adId: string | null;

  @Column({ name: 'ad_name', type: 'varchar', nullable: true })
  adName: string | null;

  @Column({ name: 'form_id', type: 'varchar', nullable: true })
  formId: string | null;

  @Column({ name: 'form_name', type: 'varchar', nullable: true })
  formName: string | null;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  @Column({ type: 'jsonb', nullable: true })
  interests: string[] | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  answers: SubmissionAnswer[];

  @Column({ name: 'utm_source', type: 'varchar', nullable: true })
  utmSource: string | null;

  @Column({ name: 'utm_campaign', type: 'varchar', nullable: true })
  utmCampaign: string | null;

  @Column({ type: 'varchar', nullable: true })
  ttclid: string | null;

  @Column({ name: 'quality_score', type: 'integer' })
  qualityScore: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  warnings: SubmissionWarning[];

  /** PENDING → SUCCESS (đã lên Bitrix24) / FAILED. */
  @Column({ name: 'sync_status_kbn', type: 'integer' })
  syncStatusKbn: number;

  @Column({ name: 'bitrix_action_kbn', type: 'integer', nullable: true })
  bitrixActionKbn: number | null;

  @Column({ name: 'error_kbn', type: 'integer', nullable: true })
  errorKbn: number | null;

  @Column({ name: 'error_detail', type: 'jsonb', nullable: true })
  errorDetail: JsonObject | null;

  /** Lúc form.complete cập nhật lượt gửi (mục 4.4). */
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'timeline_posted_at', type: 'timestamptz', nullable: true })
  timelinePostedAt: Date | null;

  @Column({ name: 'completion_posted_at', type: 'timestamptz', nullable: true })
  completionPostedAt: Date | null;

  @Column({
    name: 'deal_comment_posted_at',
    type: 'timestamptz',
    nullable: true,
  })
  dealCommentPostedAt: Date | null;

  @Column({ name: 'submitted_at', type: 'timestamptz' })
  submittedAt: Date;

  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true })
  syncedAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
