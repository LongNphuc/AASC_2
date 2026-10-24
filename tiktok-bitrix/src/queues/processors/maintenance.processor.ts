import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { AlertCheckService } from '../../analytics/services/alert-check.service';
import { DailyReportService } from '../../analytics/services/daily-report.service';
import { WARN } from '../../common/constants/messages.constant';
import { logContext } from '../../common/logging/request-context';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { JOB, QUEUE, type MaintenanceJobData } from '../queue-names';
import { RecoveryService } from '../services/recovery.service';

/** Worker của queue maintenance: recovery, daily-report, alert-check (một job mỗi lúc). */
@Processor(QUEUE.MAINTENANCE, { concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new ServiceLogger(
    LogService.JOB,
    MaintenanceProcessor.name,
  );

  constructor(
    private readonly recovery: RecoveryService,
    private readonly dailyReport: DailyReportService,
    private readonly alertCheck: AlertCheckService,
  ) {
    super();
  }

  process(job: Job<MaintenanceJobData>): Promise<unknown> {
    return logContext.run(job.name.slice(0, 8), async () => {
      const startedAt = Date.now();
      let result: unknown;
      switch (job.name) {
        case JOB.RECOVERY:
          result = await this.recovery.run(job.data ?? {});
          break;
        case JOB.DAILY_REPORT:
          result = { report: (await this.dailyReport.run()).uuid };
          break;
        case JOB.ALERT_CHECK:
          result = { raised: await this.alertCheck.check() };
          break;
        default:
          this.logger.warn(WARN.JOB.UNKNOWN_JOB(job.name));
          return null;
      }
      this.logger.record({
        action: job.name,
        result: 'DONE',
        durationMs: Date.now() - startedAt,
        detail: JSON.stringify(result),
      });
      return result;
    });
  }
}
