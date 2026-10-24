import {
  DealStatusKbn,
  LeadStatusKbn,
  StatusKbn,
} from '../../src/common/kbn/status.kbn';
import { ErrorKbn } from '../../src/common/kbn/error.kbn';
import { DealOriginKbn, SourceKbn } from '../../src/common/kbn/type.kbn';
import { WebhookEvent } from '../../src/webhooks/entities/webhook-event.entity';
import {
  resetState,
  startApi,
  startMock,
  stopAll,
  type ApiHandle,
  type MockHandle,
} from '../helpers/harness';
import { seedCustomer, type SeededCustomer } from '../helpers/seed';

describe('Lead, deal (integration)', () => {
  let mock: MockHandle;
  let api: ApiHandle;
  let a: SeededCustomer;
  let b: SeededCustomer;

  beforeAll(async () => {
    mock = await startMock();
    api = await startApi();
  });
  afterAll(() => stopAll(api, mock));

  beforeEach(async () => {
    await resetState(api, mock);
    // A: khách TikTok đã lên CRM, hai lượt gửi, lượt đầu tạo deal mở ở pipeline 1.
    a = await seedCustomer(api.dataSource, {
      lead: { bitrix24Id: 101, statusKbn: LeadStatusKbn.CONVERTED },
      submissions: [
        {},
        {
          campaignId: '555',
          campaignName: 'Black Friday',
          qualityScore: 40,
          submittedAt: new Date(1709900000000),
        },
      ],
      deals: [{ bitrix24Id: null }],
    });
    // B: khách import từ Facebook, chưa lên CRM, lượt gửi đang chờ.
    b = await seedCustomer(api.dataSource, {
      lead: {
        name: 'Trần Thị B',
        email: 'b@y.vn',
        phone: '+84912345678',
        city: 'HCM',
        statusKbn: LeadStatusKbn.NEW,
      },
      submissions: [
        {
          channelKbn: SourceKbn.FACEBOOK,
          syncStatusKbn: StatusKbn.PENDING,
          campaignName: 'FB Q1',
          campaignId: '777',
        },
      ],
    });
  });

  describe('GET /api/v1/leads', () => {
    it('danh sách có phân trang, mới nhất trước, dạng camelCase', async () => {
      const res = await api.http().get('/api/v1/leads?limit=1').expect(200);
      expect(res.body.meta).toEqual({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect(res.body.data).toHaveLength(1);
      const all = (await api.http().get('/api/v1/leads').expect(200)).body
        .data as Record<string, unknown>[];
      expect(all.find((l) => l.uuid === a.lead.uuid)).toMatchObject({
        name: 'Nguyễn Văn A',
        sources: ['tiktok'],
        status: 'converted',
        statusKbn: LeadStatusKbn.CONVERTED,
        bitrix24Id: 101,
        submissionCount: 2,
        openDealCount: 1,
        latestSubmission: {
          campaignName: 'Black Friday',
          syncStatus: 'synced',
        },
      });
    });

    it.each([
      ['source=facebook', 'b'],
      ['status=converted', 'a'],
      ['status=new', 'b'],
      ['sync_status=pending', 'b'],
      ['q=nguyenvana', 'a'],
      ['q=0912345678', 'b'],
      ['campaign_id=555', 'a'],
    ])('lọc %s', async (query, who) => {
      const res = await api.http().get(`/api/v1/leads?${query}`).expect(200);
      expect((res.body.data as { uuid: string }[]).map((l) => l.uuid)).toEqual([
        (who === 'a' ? a : b).lead.uuid,
      ]);
    });

    it('tham số sai: 400 20001', async () => {
      expect(
        (await api.http().get('/api/v1/leads?status=x').expect(400)).body
          .errorKbn,
      ).toBe(ErrorKbn.VALIDATION);
      await api.http().get('/api/v1/leads?limit=1000').expect(400);
    });
  });

  describe('GET /api/v1/leads/:uuid', () => {
    it('kèm mọi lượt gửi và deal', async () => {
      const res = await api
        .http()
        .get(`/api/v1/leads/${a.lead.uuid}`)
        .expect(200);
      expect(res.body.submissions).toHaveLength(2);
      expect(res.body.submissions).toContainEqual(
        expect.objectContaining({
          uuid: a.submissions[0].uuid,
          dealUuid: a.deals[0].uuid,
        }),
      );
      expect(res.body.deals).toEqual([
        expect.objectContaining({ uuid: a.deals[0].uuid, status: 'open' }),
      ]);
    });

    it('không có: 404 20003; không phải uuid: 400', async () => {
      expect(
        (
          await api
            .http()
            .get('/api/v1/leads/00000000-0000-4000-8000-000000000000')
            .expect(404)
        ).body.errorKbn,
      ).toBe(ErrorKbn.NOT_FOUND);
      await api.http().get('/api/v1/leads/abc').expect(400);
    });
  });

  describe('GET /api/v1/deals', () => {
    beforeEach(async () => {
      await seedCustomer(api.dataSource, {
        lead: {
          name: 'Lê C',
          email: 'c@z.vn',
          phone: '+84987654321',
          bitrix24Id: 103,
        },
        deals: [
          {
            statusKbn: DealStatusKbn.WON,
            stage: 'C1:WON',
            probability: 100,
            assignedTo: 9,
            originKbn: DealOriginKbn.MANUAL,
            bitrix24Id: 5,
          },
        ],
      });
    });

    it('lọc theo trạng thái, người phụ trách, nguồn tạo', async () => {
      const open = await api
        .http()
        .get('/api/v1/deals?status=open')
        .expect(200);
      expect(open.body.data).toEqual([
        expect.objectContaining({
          uuid: a.deals[0].uuid,
          lead: { uuid: a.lead.uuid, name: 'Nguyễn Văn A', bitrix24Id: 101 },
          stage: 'C1:NEW',
          status: 'open',
          origin: 'rule',
          probability: 40,
          amount: 7500000,
          originSubmission: expect.objectContaining({
            campaignName: 'Spring Sale 2024',
            eventType: 'lead.generate',
          }) as object,
        }),
      ]);
      expect(
        (await api.http().get('/api/v1/deals?assigned_to=9').expect(200)).body
          .data,
      ).toHaveLength(1);
      expect(
        (
          await api
            .http()
            .get('/api/v1/deals?origin=manual&status=won')
            .expect(200)
        ).body.data,
      ).toHaveLength(1);
      expect(
        (
          await api
            .http()
            .get('/api/v1/deals?campaign_id=1234567890123456789')
            .expect(200)
        ).body.meta.total,
      ).toBe(2);
    });

    it('GET /api/v1/deals/:uuid; không có thì 404', async () => {
      const res = await api
        .http()
        .get(`/api/v1/deals/${a.deals[0].uuid}`)
        .expect(200);
      expect(res.body).toMatchObject({
        uuid: a.deals[0].uuid,
        attachedSubmissionCount: 0,
      });
      await api
        .http()
        .get('/api/v1/deals/00000000-0000-4000-8000-000000000000')
        .expect(404);
    });
  });

  describe('POST /api/v1/leads/:uuid/convert-to-deal', () => {
    const convert = (uuid: string, body: object = {}) =>
      api.http().post(`/api/v1/leads/${uuid}/convert-to-deal`).send(body);

    it('pipeline, stage không có trong stage_probability: 400 20004', async () => {
      expect(
        (await convert(a.lead.uuid, { pipeline_id: '2' }).expect(400)).body
          .errorKbn,
      ).toBe(ErrorKbn.CONFIG_INVALID);
      expect(
        (await convert(a.lead.uuid, { stage_id: 'DONE' }).expect(400)).body
          .errorKbn,
      ).toBe(ErrorKbn.CONFIG_INVALID);
    });

    it('hợp lệ: 202, ghi yêu cầu MANUAL, đẩy job convert-deal', async () => {
      // Deal cũ ở pipeline 1 đã đóng: lượt gửi thứ hai (chưa có deal) được chuyển tay.
      await api.dataSource.query(`UPDATE deals SET status_kbn = $1`, [
        DealStatusKbn.LOST,
      ]);
      const ok = await convert(a.lead.uuid, {
        stage_id: 'PREPARATION',
        amount: 1000,
      }).expect(202);
      expect(ok.body).toEqual({
        dealUuid: expect.any(String) as string,
        status: 'queued',
      });
      const row = await api.dataSource
        .getRepository(WebhookEvent)
        .findOneByOrFail({ eventId: ok.body.dealUuid as string });
      expect(row).toMatchObject({
        providerKbn: SourceKbn.MANUAL,
        eventName: 'convert-to-deal',
      });
      expect(row.payload).toMatchObject({
        lead_uuid: a.lead.uuid,
        stage_id: 'PREPARATION',
        amount: 1000,
      });
    });

    it('đã có deal mở ở pipeline (E15): 409 20013 kèm dealUuid', async () => {
      const res = await convert(a.lead.uuid).expect(409);
      expect(res.body).toMatchObject({
        errorKbn: ErrorKbn.DEAL_ALREADY_OPEN,
        details: { dealUuid: a.deals[0].uuid },
      });
    });

    it('lượt gửi đã có deal (E37): 409 20018; lượt gửi của khách khác: 404', async () => {
      const res = await convert(a.lead.uuid, {
        lead_submission_uuid: a.submissions[0].uuid,
      }).expect(409);
      expect(res.body).toMatchObject({
        errorKbn: ErrorKbn.SUBMISSION_HAS_DEAL,
        details: { dealUuid: a.deals[0].uuid },
      });
      await convert(a.lead.uuid, {
        lead_submission_uuid: b.submissions[0].uuid,
      }).expect(404);
    });

    it('khách chưa lên CRM: 409 20017; không có khách: 404; body sai: 400', async () => {
      expect((await convert(b.lead.uuid).expect(409)).body.errorKbn).toBe(
        ErrorKbn.LEAD_NOT_IN_CRM,
      );
      await convert('00000000-0000-4000-8000-000000000000').expect(404);
      await convert(a.lead.uuid, { probability: 101 }).expect(400);
    });

    it('deal mở trong DB đã thắng trên CRM (E36): không 409', async () => {
      const item = (await fetch(
        `${process.env.BITRIX24_WEBHOOK_URL}/crm.item.add`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityTypeId: 2,
            fields: { title: 'x', categoryId: 1, stageId: 'C1:WON' },
          }),
        },
      ).then((r) => r.json())) as { result: { item: { id: number } } };
      await api.dataSource.query(`UPDATE deals SET bitrix24_id = $1`, [
        item.result.item.id,
      ]);
      await convert(a.lead.uuid).expect(202);
    });
  });
});
