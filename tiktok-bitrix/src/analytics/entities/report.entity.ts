import type { JsonObject } from '../../database/json';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Bảng reports: báo cáo định kỳ đã lưu (readme_design.md mục 9.7). */
@Entity({ name: 'reports' })
export class Report {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  /** daily. */
  @Column({ type: 'varchar', length: 20 })
  type: string;

  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @Column({ type: 'jsonb' })
  payload: JsonObject;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
