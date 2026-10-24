import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { MaintenanceModule } from './queues/maintenance.module';
import { WorkerHeartbeatService } from './queues/services/worker-heartbeat.service';

/**
 * Process worker: CoreModule + processor của crm-pipeline + processor của
 * maintenance + Job Scheduler + nhịp tim. Không mở cổng HTTP.
 */
@Module({
  imports: [
    CoreModule.forRoot({ runMigrations: false }),
    PipelineModule,
    MaintenanceModule,
  ],
  providers: [WorkerHeartbeatService],
})
export class WorkerModule {}
