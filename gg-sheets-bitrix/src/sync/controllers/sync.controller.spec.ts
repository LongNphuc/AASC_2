import { HttpException } from '@nestjs/common';
import { StatusKbn } from '../../common/kbn/status.kbn';
import { BatchStatusKbn } from '../../common/kbn/sync.kbn';
import type { AppConfig } from '../../config/app-config';
import type { SyncBatchRepository } from '../repositories/sync-batch.repository';
import type { SyncRunRepository } from '../repositories/sync-run.repository';
import type { SyncRunnerService } from '../services/sync-runner.service';
import { SyncController } from './sync.controller';

const config = { sync: { staleSeconds: 120 } } as AppConfig;

function controller(start: unknown) {
  const runner = { start: jest.fn().mockResolvedValue(start) };
  const batches = { findAll: jest.fn() };
  const runs = { list: jest.fn(), findOne: jest.fn() };
  return {
    runner,
    batches,
    runs,
    ctrl: new SyncController(
      runner as unknown as SyncRunnerService,
      batches as unknown as SyncBatchRepository,
      runs as unknown as SyncRunRepository,
      config,
    ),
  };
}

async function errorOf(promise: Promise<unknown>) {
  const error = (await promise.catch((e: unknown) => e)) as HttpException;
  return {
    status: error.getStatus(),
    body: error.getResponse() as Record<string, unknown>,
    kbn: (error as unknown as { errorKbn: number }).errorKbn,
  };
}

describe('SyncController', () => {
  it('POST /sync/run: giành được khóa → 202 kèm runUuid', async () => {
    const startedAt = new Date();
    const { ctrl } = controller({ started: true, runUuid: 'r1', startedAt });
    expect(await ctrl.run()).toEqual({
      runUuid: 'r1',
      status: 'PROCESSING',
      statusKbn: StatusKbn.PROCESSING,
      startedAt,
    });
  });

  it('POST /sync/run?batch=GOOGLE_TOKEN_REFRESH: chạy đúng batch được chọn', async () => {
    const { ctrl, runner } = controller({
      started: true,
      runUuid: 'r2',
      startedAt: new Date(),
    });
    await ctrl.run({ batch: 'GOOGLE_TOKEN_REFRESH' });
    expect(runner.start).toHaveBeenCalledWith(14002, 13002);
    await ctrl.run();
    expect(runner.start).toHaveBeenLastCalledWith(14001, 13002);
  });

  it('đang chạy → 409 (60001); đang cooldown → 429 (60002) kèm Retry-After; chưa có mapping → 400', async () => {
    const busy = await errorOf(
      controller({
        started: false,
        reason: 'LOCKED',
        lock: {
          acquired: false,
          reason: 'BUSY',
          runUuid: 'r0',
          startedAt: new Date(),
          heartbeatAt: null,
        },
      }).ctrl.run(),
    );
    expect(busy).toMatchObject({
      status: 409,
      kbn: 60001,
      body: { details: { runUuid: 'r0' } },
    });

    const until = new Date(Date.now() + 90_000);
    const cooldown = await errorOf(
      controller({
        started: false,
        reason: 'LOCKED',
        lock: { acquired: false, reason: 'COOLDOWN', cooldownUntil: until },
      }).ctrl.run(),
    );
    expect(cooldown).toMatchObject({ status: 429, kbn: 60002 });
    expect(
      (cooldown.body.details as { retryAfterSeconds: number })
        .retryAfterSeconds,
    ).toBeGreaterThan(80);

    expect(
      await errorOf(
        controller({ started: false, reason: 'NO_MAPPING' }).ctrl.run(),
      ),
    ).toMatchObject({ status: 400, kbn: 20004 });
    expect(
      await errorOf(
        controller({
          started: false,
          reason: 'LOCKED',
          lock: { acquired: false, reason: 'NOT_FOUND' },
        }).ctrl.run(),
      ),
    ).toMatchObject({ status: 404 });
  });

  it('GET /sync/batches: tên, chu kỳ, nhịp tim cũ thì stale, lần chạy kế tiếp', async () => {
    const { ctrl, batches } = controller(null);
    batches.findAll.mockResolvedValue([
      {
        batchKbn: 14001,
        name: 'Sheet',
        intervalSeconds: 900,
        batchStatusKbn: BatchStatusKbn.RUNNING,
        runUuid: 'r',
        startedAt: new Date(),
        finishedAt: null,
        heartbeatAt: new Date(Date.now() - 300_000),
        cooldownUntil: null,
      },
      {
        batchKbn: 14001,
        name: 'Sheet',
        intervalSeconds: 900,
        batchStatusKbn: BatchStatusKbn.DONE,
        runUuid: null,
        startedAt: null,
        finishedAt: new Date('2026-10-15T03:00:40Z'),
        heartbeatAt: null,
        cooldownUntil: new Date(0),
      },
    ]);
    const [running, done] = await ctrl.listBatches();
    expect(running).toMatchObject({
      batch: 'SHEET_TO_BITRIX',
      status: 'RUNNING',
      stale: true,
      nextRunAt: null,
    });
    expect(done).toMatchObject({
      status: 'DONE',
      stale: false,
      cooldownUntil: null,
      nextRunAt: new Date('2026-10-15T03:15:40Z'),
    });
  });

  it('GET /sync/runs và /sync/runs/:uuid', async () => {
    const { ctrl, runs } = controller(null);
    const run = {
      uuid: 'u',
      batchKbn: 14001,
      triggerKbn: 13001,
      statusKbn: 10004,
      errorKbn: null,
      errorDetail: null,
      mappingVersion: 3,
      startedAt: new Date(),
      finishedAt: new Date(),
      summary: null,
      problemRows: [{ rows: [] }],
    };
    runs.list.mockResolvedValue([run]);
    runs.findOne.mockResolvedValueOnce(run).mockResolvedValueOnce(null);
    const [listed] = await ctrl.listRuns({});
    expect(listed).toMatchObject({
      batch: 'SHEET_TO_BITRIX',
      trigger: 'SCHEDULE',
      status: 'PARTIAL',
      mappingVersion: 3,
    });
    expect(listed).not.toHaveProperty('problem_rows');
    expect(runs.list).toHaveBeenCalledWith(14001, 20);
    expect(await ctrl.runDetail('u')).toHaveProperty('problem_rows', [
      { rows: [] },
    ]);
    expect(await errorOf(ctrl.runDetail('x'))).toMatchObject({ status: 404 });
  });
});
