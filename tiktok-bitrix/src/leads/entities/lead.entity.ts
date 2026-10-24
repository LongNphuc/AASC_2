import type { JsonObject } from '../../database/json';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Bảng leads: một khách hàng, nhận diện bằng email hoặc SĐT (readme_design.md mục 1). */
@Entity({ name: 'leads' })
export class Lead {
  /** Cũng là ORIGIN_ID của lead và originId của Contact trên Bitrix24. */
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  /** Bản đã gộp, mới nhất theo thời điểm gửi form (mục 4.4). */
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  city: string | null;

  @Column({ name: 'bitrix24_id', type: 'integer', nullable: true })
  bitrix24Id: number | null;

  @Column({ name: 'bitrix_contact_id', type: 'integer', nullable: true })
  bitrixContactId: number | null;

  @Column({
    name: 'bitrix_sync_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  bitrixSyncHash: string | null;

  /** Bản field đã đẩy thành công gần nhất (mục 5.3). */
  @Column({ name: 'bitrix_synced_fields', type: 'jsonb', nullable: true })
  bitrixSyncedFields: JsonObject | null;

  @Column({ name: 'bitrix_synced_at', type: 'timestamptz', nullable: true })
  bitrixSyncedAt: Date | null;

  @Column({
    name: 'bitrix_contact_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  bitrixContactHash: string | null;

  /** NEW → IN_CRM → CONVERTED. */
  @Column({ name: 'status_kbn', type: 'integer' })
  statusKbn: number;

  @Column({ name: 'first_submitted_at', type: 'timestamptz' })
  firstSubmittedAt: Date;

  @Column({ name: 'last_submitted_at', type: 'timestamptz' })
  lastSubmittedAt: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
