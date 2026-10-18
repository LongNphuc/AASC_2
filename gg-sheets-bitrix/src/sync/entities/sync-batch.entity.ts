import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { BatchStatusKbn } from '../../common/kbn/sync.kbn';

/** Bảng sync_batches: lịch chạy và khóa, mỗi batch một dòng. */
@Entity({ name: 'sync_batches' })
export class SyncBatch {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  @Column({ name: 'batch_kbn', type: 'integer', unique: true })
  batchKbn: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Chu kỳ chạy: lần kế tiếp = finished_at + interval_seconds. */
  @Column({ name: 'interval_seconds', type: 'integer' })
  intervalSeconds: number;

  @Column({ name: 'batch_status_kbn', type: 'integer' })
  batchStatusKbn: BatchStatusKbn;

  /** Lần chạy đang (hoặc vừa) giữ khóa. */
  @Column({ name: 'run_uuid', type: 'uuid', nullable: true })
  runUuid: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null;

  /** Chưa được chạy trước thời điểm này (API báo hết giới hạn). */
  @Column({ name: 'cooldown_until', type: 'timestamptz', nullable: true })
  cooldownUntil: Date | null;
}
