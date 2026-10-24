import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Repository } from 'typeorm';
import type { AlertService } from '../analytics/services/alert.service';
import { ExternalApiError } from '../common/errors/external-api.error';
import { ErrorKbn } from '../common/kbn/error.kbn';
import { JobStepKbn, WebhookStatusKbn } from '../common/kbn/status.kbn';
import { AlertTypeKbn } from '../common/kbn/type.kbn';
import type { AppConfig } from '../config/app-config';
import type { LeadSubmission } from '../leads/entities/lead-submission.entity';
import type { PipelineJobData } from '../queues/queue-names';
import { makeEvent } from '../testing/fixtures';
import type { WebhookEvent } from '../webhooks/entities/webhook-event.entity';
import type { BitrixDealEventJob } from './jobs/bitrix-deal-event.job';
import type { ConvertDealJob } from './jobs/convert-deal.job';
import type { StepRunner } from './jobs/step-runner';
import type { TiktokEventJob } from './jobs/tiktok-event.job';
import { CrmPipelineProcessor } from './processors/crm-pipeline.processor';

/** Processor với bước ném `error`, sự kiện đang ở bước 3a, `retryCount` vòng đã chạy. */
function setup(error: Error, retryCount = 0) {
  const event = makeEvent({ currentStepKbn: JobStepKbn.LEAD_SYNC, retryCount });
  const updates: Partial<WebhookEvent>[] = [];
  const alerts: { type: AlertTypeKbn; message: string }[] = [];
  const processor = new CrmPipelineProcessor(
    { run: () => Promise.reject(error) } as unknown as StepRunner,
    { steps: () => [] } as unknown as TiktokEventJob,
    {} as BitrixDealEventJob,
    {} as ConvertDealJob,
    {
      raise: (type: AlertTypeKbn, _subject: string, message: string) => {
        alerts.push({ type, message });
        return Promise.resolve({});
      },
    } as unknown as AlertService,
    {
      findOneBy: () => Promise.resolve(event),
      update: (_where: unknown, values: Partial<WebhookEvent>) => {
        updates.push(values);
        return Promise.resolve();
      },
    } as unknown as Repository<WebhookEvent>,
    {} as Repository<LeadSubmission>,
    { queue: { recoveryMaxRounds: 3 } } as AppConfig,
  );
  const run = (attemptsMade: number) =>
    processor.process({
      name: 'tiktok-event',
      data: { webhookEventUuid: event.uuid },
      opts: { attempts: 4 },
      attemptsMade,
    } as Job<PipelineJobData>);
  return { run, updates, alerts };
}

describe('CrmPipelineProcessor khi job lỗi', () => {
  const errorLog = Logger.prototype.error as jest.Mock;
  beforeEach(() => errorLog.mockClear());

  it('lỗi không lường trước (90001) ở lượt thử cuối: FAILED, retryable false, cảnh báo SYNC_FAILED, log kèm stack', async () => {
    const bug = new TypeError(
      "Cannot read properties of undefined (reading 'id')",
    );
    const { run, updates, alerts } = setup(bug);
    await expect(run(3)).rejects.toThrow(/^90001 SYSTEM\.UNKNOWN: Cannot read/);

    expect(updates).toEqual([
      expect.objectContaining({
        statusKbn: WebhookStatusKbn.FAILED,
        errorKbn: ErrorKbn.UNKNOWN,
        errorDetail: expect.objectContaining({
          retryable: false,
          step: JobStepKbn.LEAD_SYNC,
        }) as object,
      }),
    ]);
    expect(alerts).toEqual([
      {
        type: AlertTypeKbn.SYNC_FAILED,
        message: expect.stringContaining('lỗi không lường trước') as string,
      },
    ]);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('dừng ở bước 11103 LEAD_SYNC (3a)'),
      bug.stack,
    );
  });

  it('90001 chưa hết lượt thử: chỉ ghi log lượt thử, BullMQ thử lại', async () => {
    const { run, updates, alerts } = setup(new Error('bug'));
    await expect(run(0)).rejects.toThrow('90001');
    expect(updates).toEqual([]);
    expect(alerts).toEqual([]);
  });

  it('lỗi tạm thời hết lượt thử: còn vòng recovery thì không báo; hết vòng thì DLQ_NOT_EMPTY', async () => {
    const overload = () =>
      new ExternalApiError('bitrix24', 'RATE_LIMIT', 'quá tải');
    const pending = setup(overload());
    await expect(pending.run(3)).rejects.toThrow('40009');
    expect(pending.updates[0]).toMatchObject({
      errorDetail: { retryable: true },
    });
    expect(pending.alerts).toEqual([]);

    const exhausted = setup(overload(), 3);
    await expect(exhausted.run(3)).rejects.toThrow('40009');
    expect(exhausted.alerts.map((a) => a.type)).toEqual([
      AlertTypeKbn.DLQ_NOT_EMPTY,
    ]);
    // Lỗi đã biết: không cần stack.
    expect(errorLog).toHaveBeenLastCalledWith(expect.any(String), undefined);
  });

  it('lỗi không thử lại được: FAILED ngay lượt đầu, cảnh báo SYNC_FAILED', async () => {
    const { run, updates, alerts } = setup(
      new ExternalApiError('bitrix24', 'AUTH', 'sai quyền'),
    );
    await expect(run(0)).rejects.toThrow('40003');
    expect(updates[0]).toMatchObject({
      statusKbn: WebhookStatusKbn.FAILED,
      errorDetail: { retryable: false },
    });
    expect(alerts).toEqual([
      {
        type: AlertTypeKbn.SYNC_FAILED,
        message: expect.stringContaining('lỗi không thử lại được') as string,
      },
    ]);
  });
});
