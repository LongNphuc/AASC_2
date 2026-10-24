import type { JsonObject } from '../../database/json';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Bảng conversion_events: một sự kiện báo về TikTok Events API (readme_design.md mục 8). */
@Entity({ name: 'conversion_events' })
export class ConversionEvent {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  @Column({ name: 'deal_uuid', type: 'uuid' })
  dealUuid: string;

  @Column({ name: 'lead_submission_uuid', type: 'uuid', nullable: true })
  leadSubmissionUuid: string | null;

  /** DEAL_CREATED, DEAL_WON; UNIQUE cùng deal_uuid. */
  @Column({ name: 'event_kbn', type: 'integer' })
  eventKbn: number;

  @Column({ name: 'tiktok_event_name', type: 'varchar', length: 100 })
  tiktokEventName: string;

  /** Cố định theo deal và loại sự kiện: gửi lại không bị TikTok đếm trùng. */
  @Column({ name: 'event_id', type: 'varchar', length: 255 })
  eventId: string;

  /** PENDING, SUCCESS, FAILED. */
  @Column({ name: 'status_kbn', type: 'integer' })
  statusKbn: number;

  @Column({ name: 'tiktok_request_id', type: 'varchar', nullable: true })
  tiktokRequestId: string | null;

  @Column({ name: 'error_kbn', type: 'integer', nullable: true })
  errorKbn: number | null;

  @Column({ name: 'error_detail', type: 'jsonb', nullable: true })
  errorDetail: JsonObject | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
