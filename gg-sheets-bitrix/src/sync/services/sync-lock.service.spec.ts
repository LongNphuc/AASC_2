import { BatchStatusKbn, TriggerKbn } from '../../common/kbn/sync.kbn';
import type { AppConfig } from '../../config/app-config';
import type { SyncBatchRepository } from '../repositories/sync-batch.repository';
import { SyncLockService } from './sync-lock.service';

const config = { sync: { staleSeconds: 120 } } as AppConfig;

function service(acquired: unknown, batch: unknown) {
  const repo = {
    acquire: jest.fn().mockResolvedValue(acquired),
    find: jest.fn().mockResolvedValue(batch),
    heartbeat: jest.fn().mockResolvedValue(true),
    release: jest.fn(),
    setCooldown: jest.fn(),
  };
  return {
    repo,
    lock: new SyncLockService(repo as unknown as SyncBatchRepository, config),
  };
}

describe('SyncLockService', () => {
  it('chạy tay thì bỏ qua điều kiện mốc; giành được trả runUuid', async () => {
    const { repo, lock } = service(
      { runUuid: 'r1', recoveredRunUuid: 'old' },
      null,
    );
    expect(await lock.acquire(14001, TriggerKbn.MANUAL, 'm1')).toEqual({
      acquired: true,
      runUuid: 'r1',
    });
    expect(repo.acquire).toHaveBeenCalledWith({
      batchKbn: 14001,
      triggerKbn: TriggerKbn.MANUAL,
      mappingUuid: 'm1',
      manual: true,
      staleSeconds: 120,
    });
  });

  it('không giành được: đọc lại dòng batch để biết lý do', async () => {
    const future = new Date(Date.now() + 60_000);
    expect(
      await service(null, { cooldownUntil: future }).lock.acquire(
        14001,
        TriggerKbn.SCHEDULE,
        'm',
      ),
    ).toEqual({ acquired: false, reason: 'COOLDOWN', cooldownUntil: future });
    expect(
      await service(null, {
        batchStatusKbn: BatchStatusKbn.RUNNING,
        runUuid: 'r0',
        startedAt: null,
        heartbeatAt: null,
      }).lock.acquire(14001, TriggerKbn.MANUAL, 'm'),
    ).toMatchObject({ reason: 'BUSY', runUuid: 'r0' });
    expect(
      await service(null, {
        batchStatusKbn: BatchStatusKbn.DONE,
        cooldownUntil: new Date(0),
      }).lock.acquire(14001, TriggerKbn.SCHEDULE, 'm'),
    ).toEqual({ acquired: false, reason: 'NOT_DUE' });
    expect(
      await service(null, null).lock.acquire(14001, TriggerKbn.SCHEDULE, 'm'),
    ).toEqual({ acquired: false, reason: 'NOT_FOUND' });
  });

  it('nhịp tim, trả khóa, cooldown chuyển cho repository', async () => {
    const { repo, lock } = service(null, null);
    await expect(lock.heartbeat(1, 'r')).resolves.toBe(true);
    await lock.release(1, 'r');
    const until = new Date();
    await lock.setCooldown(1, 'r', until);
    expect(repo.release).toHaveBeenCalledWith(1, 'r');
    expect(repo.setCooldown).toHaveBeenCalledWith(1, 'r', until);
  });
});
