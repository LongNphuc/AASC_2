import type { JsonObject } from '../../database/json';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../database/numeric.transformer';

/** Bảng deals (readme_design.md mục 11.2). */
@Entity({ name: 'deals' })
export class Deal {
  /** Cũng là originId của deal trên Bitrix24. */
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  @Column({ name: 'lead_uuid', type: 'uuid' })
  leadUuid: string;

  /** Lượt gửi đã tạo ra deal (tính công cho campaign của lượt gửi đó). */
  @Column({ name: 'lead_submission_uuid', type: 'uuid' })
  leadSubmissionUuid: string;

  /** Trống tới khi Bitrix24 trả ID. */
  @Column({ name: 'bitrix24_id', type: 'integer', nullable: true })
  bitrix24Id: number | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  /** categoryId trên Bitrix24. */
  @Column({ name: 'pipeline_id', type: 'varchar', length: 50 })
  pipelineId: string;

  /** Mã đầy đủ trên Bitrix24, ví dụ C1:NEW. */
  @Column({ type: 'varchar', length: 100 })
  stage: string;

  /** OPEN, WON, LOST, DELETED. */
  @Column({ name: 'status_kbn', type: 'integer' })
  statusKbn: number;

  /** RULE, MANUAL. */
  @Column({ name: 'origin_kbn', type: 'integer' })
  originKbn: number;

  /** Rule đã khớp lúc tạo, để giải thích vì sao có deal. */
  @Column({ name: 'rule_snapshot', type: 'jsonb', nullable: true })
  ruleSnapshot: JsonObject | null;

  @Column({ type: 'integer', default: 0 })
  probability: number;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  amount: number | null;

  @Column({ type: 'varchar', length: 3, default: 'VND' })
  currency: string;

  /** ID người dùng Bitrix24. */
  @Column({ name: 'assigned_to', type: 'integer', nullable: true })
  assignedTo: number | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'bitrix_synced_at', type: 'timestamptz', nullable: true })
  bitrixSyncedAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
