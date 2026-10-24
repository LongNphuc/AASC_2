import type { JsonObject } from '../../database/json';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Bảng webhook_events: mọi sự kiện đã qua kiểm tra, nguyên văn, để audit và
 * debug; cũng là nơi giữ trạng thái của job tương ứng (readme_design.md mục
 * 11.2). Mọi job của crm-pipeline đều có một dòng ở đây: webhook TikTok,
 * webhook Bitrix24, bản ghi import, yêu cầu chuyển tay thành deal.
 */
@Entity({ name: 'webhook_events' })
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  /** TIKTOK, BITRIX24, IMPORT, MANUAL. */
  @Column({ name: 'provider_kbn', type: 'integer' })
  providerKbn: number;

  /** UNIQUE cùng provider_kbn; với TikTok là event_id của payload. */
  @Column({ name: 'event_id', type: 'varchar', length: 255 })
  eventId: string;

  @Column({ name: 'event_name', type: 'varchar', length: 100, nullable: true })
  eventName: string | null;

  @Column({ name: 'event_type_kbn', type: 'integer', nullable: true })
  eventTypeKbn: number | null;

  @Column({ type: 'jsonb' })
  payload: JsonObject;

  @Column({ type: 'jsonb', nullable: true })
  headers: Record<string, string> | null;

  @Column({ name: 'bitrix_deal_id', type: 'integer', nullable: true })
  bitrixDealId: number | null;

  /** Lượt gửi mà sự kiện tạo ra hoặc cập nhật. */
  @Column({ name: 'lead_submission_uuid', type: 'uuid', nullable: true })
  leadSubmissionUuid: string | null;

  @Column({ name: 'status_kbn', type: 'integer' })
  statusKbn: number;

  @Column({ name: 'error_kbn', type: 'integer', nullable: true })
  errorKbn: number | null;

  @Column({ name: 'error_detail', type: 'jsonb', nullable: true })
  errorDetail: JsonObject | null;

  /**
   * Bước đang làm; job chết thì là bước chết, cũng là chỗ chạy tiếp. Ghi ở
   * cuối mỗi bước, cùng transaction với dữ liệu của bước (mục 10.5).
   */
  @Column({ name: 'current_step_kbn', type: 'integer', nullable: true })
  currentStepKbn: number | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt: Date | null;

  /** Số lần job đã bắt đầu chạy, gồm cả lần BullMQ thử lại và lần chạy lại sau khi bị treo. */
  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount: number;

  /** Số vòng batch recovery đã chạy lại. */
  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
