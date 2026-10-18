import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LOG, MESSAGE } from '../../common/constants/messages.constant';
import { BatchKbn, TriggerKbn } from '../../common/kbn/sync.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import { GoogleAuthService } from '../../google/services/google-auth.service';
import { formatTimestamp, nextRunAt } from '../helpers/schedule';
import { SyncBatchRepository } from '../repositories/sync-batch.repository';
import { SyncRunnerService } from '../services/sync-runner.service';

/** Looper gõ cửa mỗi 10 giây (hằng số, như looper của các hệ thống batch). */
export const LOOPER_TICK_MS = 10_000;

/**
 * Các batch looper quản lý, kèm chu kỳ lấy từ .env. Thêm batch mới là thêm
 * một dòng ở đây. Batch token đứng trước để khi cả hai cùng tới hạn nó được gõ trước.
 */
export const LOOPER_BATCHES: {
  kbn: BatchKbn;
  name: string;
  intervalSeconds: (config: AppConfig) => number;
}[] = [
  {
    kbn: BatchKbn.GOOGLE_TOKEN_REFRESH,
    name: MESSAGE.BATCH.GOOGLE_TOKEN_REFRESH,
    intervalSeconds: (config) => config.google.tokenRefreshSeconds,
  },
  {
    kbn: BatchKbn.SHEET_TO_BITRIX,
    name: MESSAGE.BATCH.SHEET_TO_BITRIX,
    intervalSeconds: (config) => config.sync.intervalSeconds,
  },
];

/**
 * Lịch chạy kiểu looper: mỗi lần gõ cửa, thử giành khóa cho từng batch kèm
 * điều kiện "đã tới hạn" (lần trước xong + interval_seconds).
 * Chưa tới hạn, đang có lần chạy khác hoặc đang cooldown thì không làm gì và
 * không ghi log (gõ cửa mỗi 10 giây, ghi log mỗi lần sẽ làm đầy log).
 */
@Injectable()
export class BatchLooperScheduler implements OnApplicationBootstrap {
  private readonly logger = new ServiceLogger(
    LogService.SYNC,
    BatchLooperScheduler.name,
  );
  private ticking = false;

  constructor(
    private readonly runner: SyncRunnerService,
    private readonly batches: SyncBatchRepository,
    private readonly auth: GoogleAuthService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  /**
   * Ghi chu kỳ của từng batch vào sync_batches mỗi lần khởi động. Chưa có token
   * Google, hoặc token sẽ hết hạn trước lần làm mới theo lịch kế tiếp, thì làm
   * mới ngay (lần chạy theo lịch đầu tiên chỉ diễn ra sau một chu kỳ).
   */
  async onApplicationBootstrap(): Promise<void> {
    for (const batch of LOOPER_BATCHES) {
      const interval = batch.intervalSeconds(this.config);
      await this.batches.ensure(batch.kbn, batch.name, interval);
      const row = await this.batches.find(batch.kbn);
      const next = nextRunAt(row?.finishedAt ?? null, interval);
      this.logger.log(
        LOG.LOOPER.REGISTERED(
          batch.name,
          interval,
          formatTimestamp(next, this.config.sync.timezone),
        ),
      );
    }
    try {
      const withinMs = this.config.google.tokenRefreshSeconds * 1000;
      if (await this.auth.needsRefresh(withinMs)) {
        this.logger.log(LOG.LOOPER.TOKEN_REFRESH_ON_STARTUP);
        await this.runner.start(
          BatchKbn.GOOGLE_TOKEN_REFRESH,
          TriggerKbn.STARTUP,
        );
      }
    } catch (error) {
      this.logError(error);
    }
  }

  @Interval(LOOPER_TICK_MS)
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const batch of LOOPER_BATCHES) {
        try {
          await this.runner.start(batch.kbn, TriggerKbn.SCHEDULE);
        } catch (error) {
          this.logError(error);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private logError(error: unknown): void {
    this.logger.error(
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined,
    );
  }
}
