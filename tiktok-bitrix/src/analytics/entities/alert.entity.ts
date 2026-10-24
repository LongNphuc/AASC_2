import type { JsonObject } from '../../database/json';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Bảng alerts: một cảnh báo (readme_design.md mục 9.8). */
@Entity({ name: 'alerts' })
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  @Column({ name: 'type_kbn', type: 'integer' })
  typeKbn: number;

  /** Loại + đối tượng: cùng fingerprint chỉ báo một lần mỗi giờ. */
  @Column({ type: 'varchar', length: 255 })
  fingerprint: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  details: JsonObject | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
