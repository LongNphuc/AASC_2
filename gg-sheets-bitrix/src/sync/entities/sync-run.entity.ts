import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { AnyRunSummary, ProblemGroup } from '../types/sync.types';

/** Bảng sync_runs: mỗi lần chạy giành được khóa là một dòng (lịch sử). */
@Entity({ name: 'sync_runs' })
export class SyncRun {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  @Column({ name: 'batch_kbn', type: 'integer' })
  batchKbn: number;

  @Column({ name: 'trigger_kbn', type: 'integer' })
  triggerKbn: number;

  @Column({ name: 'status_kbn', type: 'integer' })
  statusKbn: number;

  /** Lý do khi cả lần chạy FAILED. */
  @Column({ name: 'error_kbn', type: 'integer', nullable: true })
  errorKbn: number | null;

  @Column({ name: 'error_detail', type: 'text', nullable: true })
  errorDetail: string | null;

  @Column({ name: 'mapping_uuid', type: 'uuid', nullable: true })
  mappingUuid: string | null;

  @Column({ type: 'jsonb', nullable: true })
  summary: AnyRunSummary | null;

  @Column({ name: 'problem_rows', type: 'jsonb', nullable: true })
  problemRows: ProblemGroup[] | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
