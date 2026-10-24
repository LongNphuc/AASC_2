import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Queue } from 'bullmq';
import { API_DOC } from '../../common/constants/messages.constant';
import { JOB, QUEUE, type MaintenanceJobData } from '../queue-names';
import { DeadLetterService } from '../services/dead-letter.service';

@ApiTags('Vận hành')
@Controller('api/v1/ops')
export class OpsController {
  constructor(
    @InjectQueue(QUEUE.CRM_PIPELINE) private readonly pipeline: Queue,
    @InjectQueue(QUEUE.MAINTENANCE)
    private readonly maintenance: Queue<MaintenanceJobData>,
    private readonly deadLetters: DeadLetterService,
  ) {}

  /** Số job chờ, đang chạy, lỗi (dead letter queue) của từng queue. */
  @Get('queues')
  @ApiOperation(API_DOC.OPS.QUEUES)
  async queues() {
    return Promise.all(
      [this.pipeline, this.maintenance].map(async (queue) => {
        const counts = await queue.getJobCounts(
          'waiting',
          'prioritized',
          'active',
          'delayed',
          'failed',
          'completed',
        );
        return {
          queue: queue.name,
          globalConcurrency: (await queue.getGlobalConcurrency()) ?? null,
          ...counts,
        };
      }),
    );
  }

  @Get('dead-letters')
  @ApiOperation(API_DOC.OPS.DEAD_LETTERS)
  list() {
    return this.deadLetters.list();
  }

  /** Đẩy ngay một job recovery cho worker chạy. */
  @Post('recovery/run')
  @HttpCode(202)
  @ApiOperation(API_DOC.OPS.RECOVERY)
  @ApiQuery({ name: 'webhook_event_uuid', required: false })
  async runRecovery(@Query('webhook_event_uuid') webhookEventUuid?: string) {
    const job = await this.maintenance.add(
      JOB.RECOVERY,
      { manual: true, webhookEventUuid },
      { removeOnComplete: 100, removeOnFail: 100 },
    );
    return { jobId: job.id };
  }
}
