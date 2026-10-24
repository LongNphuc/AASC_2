import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { OpsModule } from './ops.module';
import { MaintenanceProcessor } from './processors/maintenance.processor';
import { QueuesModule } from './queues.module';
import { JobSchedulersService } from './services/job-schedulers.service';

/** Chỉ nạp trong WorkerModule: processor của queue maintenance và Job Scheduler. */
@Module({
  imports: [QueuesModule, OpsModule, AnalyticsModule],
  providers: [MaintenanceProcessor, JobSchedulersService],
})
export class MaintenanceModule {}
