import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ERROR } from '../../common/constants/messages.constant';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { StatusKbn } from '../../common/kbn/status.kbn';
import { BatchStatusKbn } from '../../common/kbn/sync.kbn';
import { SyncBatch } from '../entities/sync-batch.entity';

export interface AcquireParams {
  batchKbn: number;
  triggerKbn: number;
  /** Chỉ batch Sheet → Bitrix24 có mapping. */
  mappingUuid: string | null;
  /** Chạy tay (hoặc làm mới token lúc khởi động): bỏ qua điều kiện "đã tới mốc". */
  manual: boolean;
  staleSeconds: number;
}

export interface Acquired {
  runUuid: string;
  /** Lần chạy cũ bị giành lại khóa vì không còn nhịp tim. */
  recoveredRunUuid?: string;
}

/** TypeORM trả [rows, rowCount] cho UPDATE ... RETURNING, và rows cho câu khác. */
function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) && Array.isArray(result[0])
    ? (result[0] as T[])
    : (result as T[]);
}

function countOf(result: unknown): number {
  return Array.isArray(result) && typeof result[1] === 'number'
    ? result[1]
    : rowsOf(result).length;
}

/**
 * Câu SQL của khóa chạy trên bảng sync_batches. Mọi câu ghi sau khi giành khóa
 * đều có điều kiện run_uuid = của mình, để lần chạy đã mất khóa không ghi đè
 * lên khóa của lần chạy khác.
 */
@Injectable()
export class SyncBatchRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(SyncBatch) private readonly repo: Repository<SyncBatch>,
  ) {}

  /**
   * Tạo dòng batch nếu chưa có; cập nhật tên và chu kỳ theo cấu hình. Dòng mới
   * có finished_at = lúc tạo, nên lần chạy đầu diễn ra sau một chu kỳ thay vì
   * chạy ngay khi vừa khởi động.
   */
  async ensure(
    batchKbn: number,
    name: string,
    intervalSeconds: number,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO sync_batches (batch_kbn, name, interval_seconds, batch_status_kbn, finished_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (batch_kbn) DO UPDATE SET name = EXCLUDED.name, interval_seconds = EXCLUDED.interval_seconds`,
      [batchKbn, name, intervalSeconds, BatchStatusKbn.DONE],
    );
  }

  /**
   * Giành khóa trong một transaction ngắn, commit ngay:
   * 1. thêm dòng sync_runs (sync_batches.run_uuid là khóa ngoại tới bảng này);
   * 2. UPDATE có điều kiện: đang rảnh và (chạy tay hoặc đã qua finished_at +
   *    interval_seconds), hoặc lần
   *    chạy trước đã chết; không trong cooldown;
   * 3. không giành được thì ROLLBACK (không để lại dòng sync_runs thừa);
   *    giành lại khóa của lần chạy đã chết thì đánh dấu lần đó FAILED.
   */
  async acquire(params: AcquireParams): Promise<Acquired | null> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const [{ uuid }] = rowsOf<{ uuid: string }>(
        await runner.query(
          `INSERT INTO sync_runs (batch_kbn, trigger_kbn, status_kbn, mapping_uuid) VALUES ($1, $2, $3, $4) RETURNING uuid`,
          [
            params.batchKbn,
            params.triggerKbn,
            StatusKbn.PROCESSING,
            params.mappingUuid,
          ],
        ),
      );
      const updated = rowsOf<{
        prev_status: BatchStatusKbn;
        prev_run_uuid: string | null;
      }>(
        await runner.query(
          `UPDATE sync_batches
           SET batch_status_kbn = $2, run_uuid = $3, started_at = now(), heartbeat_at = now(), finished_at = NULL
           WHERE batch_kbn = $1
             AND (cooldown_until IS NULL OR cooldown_until <= now())
             AND (
               (batch_status_kbn = $4 AND ($5::boolean OR finished_at IS NULL
                  OR finished_at + make_interval(secs => interval_seconds) <= now()))
               OR (batch_status_kbn = $2 AND heartbeat_at < now() - make_interval(secs => $6))
             )
           RETURNING old.batch_status_kbn AS prev_status, old.run_uuid AS prev_run_uuid`,
          [
            params.batchKbn,
            BatchStatusKbn.RUNNING,
            uuid,
            BatchStatusKbn.DONE,
            params.manual,
            params.staleSeconds,
          ],
        ),
      );
      if (updated.length === 0) {
        await runner.rollbackTransaction();
        return null;
      }
      const previous = updated[0];
      let recoveredRunUuid: string | undefined;
      if (
        previous.prev_status === BatchStatusKbn.RUNNING &&
        previous.prev_run_uuid
      ) {
        recoveredRunUuid = previous.prev_run_uuid;
        await runner.query(
          `UPDATE sync_runs SET status_kbn = $2, error_kbn = $3, error_detail = $4, finished_at = now()
           WHERE uuid = $1 AND status_kbn = $5`,
          [
            recoveredRunUuid,
            StatusKbn.FAILED,
            ErrorKbn.STALE_RECOVERED,
            ERROR.SYNC.STALE_RECOVERED,
            StatusKbn.PROCESSING,
          ],
        );
      }
      await runner.commitTransaction();
      return { runUuid: uuid, recoveredRunUuid };
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  /** Nhịp tim; trả false nếu khóa đã thuộc lần chạy khác. */
  async heartbeat(batchKbn: number, runUuid: string): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE sync_batches SET heartbeat_at = now() WHERE batch_kbn = $1 AND run_uuid = $2 AND batch_status_kbn = $3`,
      [batchKbn, runUuid, BatchStatusKbn.RUNNING],
    );
    return countOf(result) > 0;
  }

  /** Trả khóa, chỉ khi khóa còn là của mình. */
  async release(batchKbn: number, runUuid: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE sync_batches SET batch_status_kbn = $3, finished_at = now()
       WHERE batch_kbn = $1 AND run_uuid = $2 AND batch_status_kbn = $4`,
      [batchKbn, runUuid, BatchStatusKbn.DONE, BatchStatusKbn.RUNNING],
    );
  }

  async setCooldown(
    batchKbn: number,
    runUuid: string,
    until: Date,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE sync_batches SET cooldown_until = $3 WHERE batch_kbn = $1 AND run_uuid = $2`,
      [batchKbn, runUuid, until],
    );
  }

  find(batchKbn: number): Promise<SyncBatch | null> {
    return this.repo.findOneBy({ batchKbn });
  }

  findAll(): Promise<SyncBatch[]> {
    return this.repo.find({ order: { batchKbn: 'ASC' } });
  }
}
