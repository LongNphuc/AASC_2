import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { LOG } from '../../common/constants/messages.constant';
import { appConfig, type AppConfig } from '../../config/app-config';
import { JOB, QUEUE, type MaintenanceJobData } from '../queue-names';

/**
 * Job định kỳ bằng Job Scheduler của BullMQ (readme_design.md mục 10.3): mỗi
 * nhịp chỉ sinh một job dù có bao nhiêu worker; giờ theo APP_TIMEZONE.
 */
@Injectable()
export class JobSchedulersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobSchedulersService.name);

  constructor(
    @InjectQueue(QUEUE.MAINTENANCE)
    private readonly maintenance: Queue<MaintenanceJobData>,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const schedules: [string, string][] = [
      [JOB.RECOVERY, this.config.queue.recoveryCron],
      [JOB.DAILY_REPORT, this.config.queue.reportDailyCron],
      [JOB.ALERT_CHECK, this.config.queue.alertCheckCron],
    ];
    for (const [name, pattern] of schedules) {
      await this.maintenance.upsertJobScheduler(
        name,
        { pattern, tz: this.config.timezone },
        { name, data: {}, opts: { removeOnComplete: 100, removeOnFail: 100 } },
      );
    }
    this.logger.log(
      LOG.JOB.SCHEDULERS(schedules.map(([n, p]) => `${n} ${p}`).join(', ')),
    );
  }
}
