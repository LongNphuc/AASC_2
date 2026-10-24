import type { JsonObject } from '../../database/json';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Bảng imports: tiến độ một lần nhập dữ liệu cũ (readme_design.md mục 9.9). */
@Entity({ name: 'imports' })
export class Import {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'file_hash', type: 'varchar', length: 64 })
  fileHash: string;

  @Column({ type: 'integer', default: 0 })
  total: number;

  @Column({ type: 'integer', default: 0 })
  enqueued: number;

  @Column({ name: 'status_kbn', type: 'integer' })
  statusKbn: number;

  @Column({ name: 'error_detail', type: 'jsonb', nullable: true })
  errorDetail: JsonObject | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
