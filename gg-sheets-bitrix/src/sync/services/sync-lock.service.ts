import { Inject, Injectable, Logger } from '@nestjs/common';
import { WARN } from '../../common/constants/messages.constant';
import { BatchStatusKbn, TriggerKbn } from '../../common/kbn/sync.kbn';
import { appConfig, type AppConfig } from '../../config/app-config';
import { SyncBatchRepository } from '../repositories/sync-batch.repository';

export type AcquireResult =
  | { acquired: true; runUuid: string }
  | {
      acquired: false;
      reason: 'BUSY';
      runUuid: string | null;
      startedAt: Date | null;
      heartbeatAt: Date | null;
    }
  | { acquired: false; reason: 'COOLDOWN'; cooldownUntil: Date }
  | { acquired: false; reason: 'NOT_DUE' | 'NOT_FOUND' };

/**
 * Khóa chạy của từng batch: giành khóa (kèm điều kiện tới mốc với lần chạy
 * theo lịch), nhịp tim, trả khóa, cooldown. Giành không được thì đọc lại dòng
 * batch để biết lý do (đang chạy, cooldown, chưa tới mốc).
 */
@Injectable()
export class SyncLockService {
  private readonly logger = new Logger(SyncLockService.name);

  constructor(
    private readonly batches: SyncBatchRepository,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async acquire(
    batchKbn: number,
    trigger: TriggerKbn,
    mappingUuid: string | null,
  ): Promise<AcquireResult> {
    const acquired = await this.batches.acquire({
      batchKbn,
      triggerKbn: trigger,
      mappingUuid,
      // Chạy tay và lần làm mới token lúc khởi động không chờ tới mốc.
      manual: trigger !== TriggerKbn.SCHEDULE,
      staleSeconds: this.config.sync.staleSeconds,
    });
    if (acquired) {
      if (acquired.recoveredRunUuid)
        this.logger.warn(WARN.SYNC.STALE_RECOVERED(acquired.recoveredRunUuid));
      return { acquired: true, runUuid: acquired.runUuid };
    }
    const batch = await this.batches.find(batchKbn);
    if (!batch) return { acquired: false, reason: 'NOT_FOUND' };
    if (batch.cooldownUntil && batch.cooldownUntil > new Date()) {
      return {
        acquired: false,
        reason: 'COOLDOWN',
        cooldownUntil: batch.cooldownUntil,
      };
    }
    if (batch.batchStatusKbn === BatchStatusKbn.RUNNING) {
      return {
        acquired: false,
        reason: 'BUSY',
        runUuid: batch.runUuid,
        startedAt: batch.startedAt,
        heartbeatAt: batch.heartbeatAt,
      };
    }
    return { acquired: false, reason: 'NOT_DUE' };
  }

  heartbeat(batchKbn: number, runUuid: string): Promise<boolean> {
    return this.batches.heartbeat(batchKbn, runUuid);
  }

  release(batchKbn: number, runUuid: string): Promise<void> {
    return this.batches.release(batchKbn, runUuid);
  }

  setCooldown(batchKbn: number, runUuid: string, until: Date): Promise<void> {
    return this.batches.setCooldown(batchKbn, runUuid, until);
  }
}
