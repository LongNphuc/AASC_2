import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { JobStepKbn, WebhookStatusKbn } from '../../src/common/kbn/status.kbn';
import { ErrorKbn } from '../../src/common/kbn/error.kbn';
import { HEARTBEAT_PREFIX } from '../../src/queues/services/worker-heartbeat.service';
import { QUEUE } from '../../src/queues/queue-names';
import { makeEvent } from '../../src/testing/fixtures';
import { WebhookEvent } from '../../src/webhooks/entities/webhook-event.entity';
import {
  resetState,
  startApi,
  stopAll,
  type ApiHandle,
} from '../helpers/harness';
import { leadPayload, sendTiktok } from '../helpers/tiktok';

describe('Health, vận hành (integration)', () => {
  let api: ApiHandle;

  beforeAll(async () => {
    api = await startApi();
  });
  beforeEach(() => resetState(api));
  afterAll(() => stopAll(api));

  describe('GET /health', () => {
    it('DB, Redis up; worker chưa có nhịp tim thì báo down nhưng vẫn 200 (E19)', async () => {
      const res = await api.http().get('/health').expect(200);
      expect(res.body.info).toMatchObject({
        database: { status: 'up' },
        redis: { status: 'up' },
      });
      expect(JSON.stringify(res.body)).toMatch(/"worker":\{[^}]*"down":true/);
    });

    it('có nhịp tim mới: worker up; queue báo số job', async () => {
      await api.redis.set(`${HEARTBEAT_PREFIX}test`, Date.now(), 'EX', 60);
      await sendTiktok(api.http, leadPayload('evt_health_1')).expect(200);
      const res = await api.http().get('/health').expect(200);
      expect(res.body.info.worker).toMatchObject({
        status: 'up',
        heartbeatAgeSeconds: 0,
      });
      expect(res.body.info.queues).toMatchObject({
        status: 'up',
        waiting: 1,
        failed: 0,
      });
    });
  });

  describe('/api/v1/ops', () => {
    it('queues: số job từng queue', async () => {
      await sendTiktok(api.http, leadPayload('evt_ops_1')).expect(200);
      const res = await api.http().get('/api/v1/ops/queues').expect(200);
      expect(res.body).toEqual([
        expect.objectContaining({
          queue: QUEUE.CRM_PIPELINE,
          waiting: 1,
          active: 0,
          failed: 0,
        }),
        expect.objectContaining({ queue: QUEUE.MAINTENANCE }),
      ]);
    });

    it('dead-letters: sự kiện FAILED kèm bước, mã lỗi, có thử lại được không', async () => {
      await api.dataSource.getRepository(WebhookEvent).insert(
        makeEvent({
          statusKbn: WebhookStatusKbn.FAILED,
          currentStepKbn: JobStepKbn.LEAD_SYNC,
          errorKbn: 40009,
          errorDetail: { message: 'Bitrix24 quá tải' },
          attemptCount: 4,
          failedAt: new Date(),
        }),
      );
      const res = await api.http().get('/api/v1/ops/dead-letters').expect(200);
      expect(res.body).toEqual([
        expect.objectContaining({
          provider: 'tiktok',
          eventId: 'evt_1234567890',
          jobName: 'tiktok-event',
          jobState: 'missing',
          currentStep: 'LEAD_SYNC',
          errorKbn: 40009,
          message: 'Bitrix24 quá tải',
          attemptCount: 4,
          retryCount: 0,
          retryable: true,
        }),
      ]);
    });

    it('recovery/run: 202, đẩy job recovery vào queue maintenance', async () => {
      const res = await api
        .http()
        .post('/api/v1/ops/recovery/run?webhook_event_uuid=abc')
        .expect(202);
      const job = await api.app
        .get<Queue>(getQueueToken(QUEUE.MAINTENANCE))
        .getJob(res.body.jobId as string);
      expect(job?.data).toEqual({ manual: true, webhookEventUuid: 'abc' });
    });
  });
});

describe('API key (integration)', () => {
  let api: ApiHandle;

  beforeAll(async () => {
    Object.assign(process.env, {
      API_KEY: 'test-api-key',
      THROTTLE_API_LIMIT: '5',
    });
    api = await startApi();
    await resetState(api);
  });
  beforeEach(async () => {
    const keys = await api.redis.keys('throttle:*');
    if (keys.length) await api.redis.del(...keys);
  });
  afterAll(async () => {
    delete process.env.API_KEY;
    delete process.env.THROTTLE_API_LIMIT;
    await stopAll(api);
  });

  it('/api/v1/* cần x-api-key đúng: thiếu, sai thì 401 20002', async () => {
    const missing = await api.http().get('/api/v1/leads').expect(401);
    expect(missing.body).toMatchObject({
      errorKbn: ErrorKbn.UNAUTHORIZED,
      path: '/api/v1/leads',
    });
    await api.http().get('/api/v1/leads').set('x-api-key', 'sai').expect(401);
    await api
      .http()
      .get('/api/v1/leads')
      .set('x-api-key', 'test-api-key')
      .expect(200);
  });

  it('giới hạn tốc độ: key sai tính theo IP (đổi key giả không né được), key đúng có bộ đếm riêng', async () => {
    for (let i = 0; i < 5; i++) {
      await api
        .http()
        .get('/api/v1/leads')
        .set('x-api-key', `gia-${i}`)
        .expect(401);
    }
    const blocked = await api
      .http()
      .get('/api/v1/leads')
      .set('x-api-key', 'gia-moi')
      .expect(429);
    expect(blocked.body.errorKbn).toBe(ErrorKbn.TOO_MANY_REQUESTS);
    await api
      .http()
      .get('/api/v1/leads')
      .set('x-api-key', 'test-api-key')
      .expect(200);
  });

  it('/health và webhook không cần API key', async () => {
    await api.http().get('/health').expect(200);
    await sendTiktok(api.http, leadPayload('evt_key_1')).expect(200);
  });

  it('đường dẫn không có: 404 dạng lỗi chung', async () => {
    const res = await api
      .http()
      .get('/api/v1/khong-co')
      .set('x-api-key', 'test-api-key')
      .expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      path: '/api/v1/khong-co',
    });
  });
});
