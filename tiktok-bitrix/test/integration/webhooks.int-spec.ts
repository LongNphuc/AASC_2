import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { WebhookStatusKbn } from '../../src/common/kbn/status.kbn';
import { ErrorKbn } from '../../src/common/kbn/error.kbn';
import { SourceKbn } from '../../src/common/kbn/type.kbn';
import { QUEUE } from '../../src/queues/queue-names';
import { WebhookEvent } from '../../src/webhooks/entities/webhook-event.entity';
import {
  resetState,
  startApi,
  stopAll,
  type ApiHandle,
} from '../helpers/harness';
import { leadPayload, sendBitrix, sendTiktok } from '../helpers/tiktok';

describe('Webhook (integration)', () => {
  let api: ApiHandle;
  let queue: Queue;
  const events = () => api.dataSource.getRepository(WebhookEvent);

  beforeAll(async () => {
    api = await startApi();
    queue = api.app.get<Queue>(getQueueToken(QUEUE.CRM_PIPELINE));
  });
  beforeEach(() => resetState(api));
  afterAll(() => stopAll(api));

  describe('POST /webhooks/tiktok/leads', () => {
    it('đúng chữ ký: 200, lưu raw RECEIVED, đẩy job theo uuid, có x-request-id', async () => {
      const res = await sendTiktok(api.http, leadPayload('evt_int_1')).expect(
        200,
      );
      expect(res.body).toEqual({ received: true, eventId: 'evt_int_1' });
      expect(res.headers['x-request-id']).toBeDefined();

      const row = await events().findOneByOrFail({ eventId: 'evt_int_1' });
      expect(row).toMatchObject({
        providerKbn: SourceKbn.TIKTOK,
        eventName: 'lead.generate',
        statusKbn: WebhookStatusKbn.RECEIVED,
      });
      expect(row.headers).toMatchObject({
        'tiktok-signature': expect.stringMatching(/s=\*\*\*$/) as string,
      });
      const jobs = await queue.getJobs(['waiting', 'prioritized', 'delayed']);
      expect(jobs.map((job) => job.data)).toContainEqual({
        webhookEventUuid: row.uuid,
      });
    });

    it('gửi trùng (E3): một dòng, phản hồi duplicate; sự kiện chưa xong thì đẩy lại job (không tạo job thứ hai)', async () => {
      for (let i = 0; i < 3; i++)
        await sendTiktok(api.http, leadPayload('evt_int_dup')).expect(200);
      const res = await sendTiktok(api.http, leadPayload('evt_int_dup')).expect(
        200,
      );
      expect(res.body).toEqual({
        received: true,
        eventId: 'evt_int_dup',
        duplicate: true,
      });
      expect(await events().countBy({ eventId: 'evt_int_dup' })).toBe(1);
      expect(await queue.count()).toBe(1);

      await events().update(
        { eventId: 'evt_int_dup' },
        { statusKbn: WebhookStatusKbn.PROCESSED },
      );
      await queue.obliterate({ force: true });
      await sendTiktok(api.http, leadPayload('evt_int_dup')).expect(200);
      expect(await queue.count()).toBe(0);
    });

    it('sự kiện lạ: lưu IGNORED, không đẩy job', async () => {
      const res = await sendTiktok(api.http, {
        event: 'lead.delete',
        event_id: 'evt_int_x',
      }).expect(200);
      expect(res.body).toEqual({ received: true, ignored: true });
      expect(
        await events().findOneByOrFail({ eventId: 'evt_int_x' }),
      ).toMatchObject({ statusKbn: WebhookStatusKbn.IGNORED });
      expect(await queue.count()).toBe(0);
    });

    it('sai chữ ký (E1): 401 20010, không lưu; chữ ký cũ (E2): 401 20011', async () => {
      const bad = await sendTiktok(api.http, leadPayload('evt_int_bad'), {
        secret: 'sai',
      }).expect(401);
      expect(bad.body).toMatchObject({
        statusCode: 401,
        errorKbn: ErrorKbn.SIGNATURE_INVALID,
        path: '/webhooks/tiktok/leads',
      });
      const old = await sendTiktok(api.http, leadPayload('evt_int_bad'), {
        timestamp: Math.floor(Date.now() / 1000) - 600,
      }).expect(401);
      expect(old.body.errorKbn).toBe(ErrorKbn.SIGNATURE_EXPIRED);
      const missing = await api
        .http()
        .post('/webhooks/tiktok/leads')
        .send({ event_id: 'x' })
        .expect(401);
      expect(missing.body.errorKbn).toBe(ErrorKbn.SIGNATURE_INVALID);
      expect(await events().count()).toBe(0);
    });

    it('body không phải JSON, thiếu event_id: 400 20001', async () => {
      expect(
        (await sendTiktok(api.http, 'không phải json').expect(400)).body
          .errorKbn,
      ).toBe(ErrorKbn.VALIDATION);
      expect(
        (await sendTiktok(api.http, { event: 'lead.generate' }).expect(400))
          .body.errorKbn,
      ).toBe(ErrorKbn.VALIDATION);
    });
  });

  describe('POST /webhooks/bitrix24/deals', () => {
    it('đúng token: 200, lưu sự kiện (đã che token), đẩy job', async () => {
      expect((await sendBitrix(api.http, 678).expect(200)).body).toEqual({
        received: true,
      });
      const [row] = await events().findBy({ providerKbn: SourceKbn.BITRIX24 });
      expect(row).toMatchObject({
        eventName: 'ONCRMDEALUPDATE',
        bitrixDealId: 678,
        statusKbn: WebhookStatusKbn.RECEIVED,
      });
      expect(row.payload).toMatchObject({ auth: { application_token: '***' } });
      expect(await queue.count()).toBe(1);
    });

    it('sự kiện khác: ignored; sai token (E16): 401 20012', async () => {
      expect(
        (await sendBitrix(api.http, 1, 'ONCRMLEADADD').expect(200)).body,
      ).toEqual({ received: true, ignored: true });
      expect(
        (await sendBitrix(api.http, 1, 'ONCRMDEALUPDATE', 'sai').expect(401))
          .body.errorKbn,
      ).toBe(ErrorKbn.BITRIX_TOKEN_INVALID);
      expect(await events().count()).toBe(0);
    });
  });
});
