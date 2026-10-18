import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { BatchKbn, TriggerKbn } from '../../common/kbn/sync.kbn';
import { appConfig, type AppConfig } from '../../config/app-config';
import { GoogleAuthService } from '../../google/services/google-auth.service';
import { SyncBatchRepository } from '../repositories/sync-batch.repository';
import { SyncRunnerService } from '../services/sync-runner.service';
import { BatchLooperScheduler, LOOPER_TICK_MS } from './batch-looper.scheduler';

const config = {
  sync: { intervalSeconds: 900, timezone: 'Asia/Ho_Chi_Minh' },
  google: { tokenRefreshSeconds: 1800 },
} as AppConfig;

describe('BatchLooperScheduler', () => {
  const runner = { start: jest.fn() };
  const batches = {
    ensure: jest.fn(),
    find: jest.fn().mockResolvedValue({ finishedAt: new Date() }),
  };
  const auth = { needsRefresh: jest.fn().mockResolvedValue(false) };
  const looper = new BatchLooperScheduler(
    runner as unknown as SyncRunnerService,
    batches as unknown as SyncBatchRepository,
    auth as unknown as GoogleAuthService,
    config,
  );

  beforeEach(() => jest.clearAllMocks());

  it('khởi động: ghi chu kỳ của batch token (1800) và batch Sheet → Bitrix24 (900) vào sync_batches', async () => {
    await looper.onApplicationBootstrap();
    expect(batches.ensure).toHaveBeenCalledWith(
      BatchKbn.GOOGLE_TOKEN_REFRESH,
      'Làm mới token Google',
      1800,
    );
    expect(batches.ensure).toHaveBeenCalledWith(
      BatchKbn.SHEET_TO_BITRIX,
      'Google Sheet → Bitrix24',
      900,
    );
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('khởi động: chưa có token hoặc token sẽ hết hạn trước lần làm mới kế tiếp → làm mới ngay', async () => {
    auth.needsRefresh.mockResolvedValueOnce(true);
    await looper.onApplicationBootstrap();
    expect(auth.needsRefresh).toHaveBeenCalledWith(1800_000);
    expect(runner.start).toHaveBeenCalledWith(
      BatchKbn.GOOGLE_TOKEN_REFRESH,
      TriggerKbn.STARTUP,
    );
  });

  it('khởi động: không đọc được DB khi kiểm tra token thì chỉ ghi log, vẫn khởi động', async () => {
    auth.needsRefresh.mockRejectedValueOnce(new Error('db down'));
    await expect(looper.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('mỗi lần gõ cửa: thử chạy từng batch theo lịch; lỗi không làm dừng looper', async () => {
    runner.start.mockRejectedValueOnce(new Error('db down'));
    await expect(looper.tick()).resolves.toBeUndefined();
    runner.start.mockResolvedValue({ started: false, reason: 'LOCKED' });
    await looper.tick();
    expect(runner.start).toHaveBeenCalledWith(
      BatchKbn.GOOGLE_TOKEN_REFRESH,
      TriggerKbn.SCHEDULE,
    );
    expect(runner.start).toHaveBeenLastCalledWith(
      BatchKbn.SHEET_TO_BITRIX,
      TriggerKbn.SCHEDULE,
    );
  });

  it('lần gõ trước chưa xong thì bỏ qua lần gõ sau', async () => {
    let finish: () => void = () => undefined;
    runner.start.mockReturnValueOnce(
      new Promise<void>((resolve) => (finish = resolve)),
    );
    const first = looper.tick();
    await looper.tick();
    finish();
    await first;
    // Lần gõ đầu gõ đủ hai batch; lần gõ thứ hai bị bỏ qua.
    expect(runner.start).toHaveBeenCalledTimes(2);
  });

  it('đăng ký interval 10 giây với @nestjs/schedule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        BatchLooperScheduler,
        { provide: SyncRunnerService, useValue: runner },
        { provide: SyncBatchRepository, useValue: batches },
        { provide: GoogleAuthService, useValue: auth },
        { provide: appConfig.KEY, useValue: config },
      ],
    }).compile();
    await moduleRef.init();
    const intervals = moduleRef.get(SchedulerRegistry).getIntervals();
    expect(intervals).toHaveLength(1);
    expect(LOOPER_TICK_MS).toBe(10_000);
    await moduleRef.close();
  });
});
