import type { INestApplicationContext } from '@nestjs/common';
import {
  DealStatusKbn,
  JobStepKbn,
  LeadStatusKbn,
  StatusKbn,
  WebhookStatusKbn,
} from '../../src/common/kbn/status.kbn';
import { ErrorKbn } from '../../src/common/kbn/error.kbn';
import { ConversionKbn } from '../../src/common/kbn/type.kbn';
import { ConversionEvent } from '../../src/conversions/entities/conversion-event.entity';
import { Deal } from '../../src/deals/entities/deal.entity';
import { EngagementEvent } from '../../src/leads/entities/engagement-event.entity';
import { Lead } from '../../src/leads/entities/lead.entity';
import { LeadSubmission } from '../../src/leads/entities/lead-submission.entity';
import { WARNING } from '../../src/leads/services/lead-event-normalizer.service';
import {
  ENTITY_CONTACT,
  ENTITY_DEAL,
} from '../../src/mock/bitrix/bitrix-mock.store';
import type { Fault } from '../../src/mock/fault-injector';
import { samplePayload } from '../../src/testing/fixtures';
import { WebhookEvent } from '../../src/webhooks/entities/webhook-event.entity';
import {
  resetState,
  startApi,
  startMock,
  startWorker,
  stopAll,
  type ApiHandle,
  type MockHandle,
} from '../helpers/harness';
import {
  leadPayload,
  sendBitrix,
  sendTiktok,
  waitFor,
} from '../helpers/tiktok';

const DONE = new Set<number>([
  WebhookStatusKbn.PROCESSED,
  WebhookStatusKbn.FAILED,
  WebhookStatusKbn.INVALID,
]);

/**
 * Các lỗi ở readme_api.md mục 10 cần cả api, worker và Bitrix24 giả. Mỗi test
 * bắt đầu từ DB, mock trống; worker chạy suốt file.
 */
describe('Kịch bản lỗi (E2E)', () => {
  let mock: MockHandle;
  let api: ApiHandle;
  let worker: INestApplicationContext;
  const repo = <T extends object>(entity: new () => T) =>
    api.dataSource.getRepository(entity);

  const settled = (eventId: string) =>
    waitFor(
      async () => {
        const event = await repo(WebhookEvent).findOneBy({ eventId });
        return event && DONE.has(event.statusKbn) ? event : null;
      },
      15_000,
      `${eventId} xử lý xong`,
    );

  /** Gửi webhook rồi chờ xử lý xong. */
  const process = async (payload: Record<string, unknown>) => {
    await sendTiktok(api.http, payload).expect(200);
    return settled(payload.event_id as string);
  };

  const fault = (value: Partial<Fault>) =>
    mock.faults.add({ service: 'bitrix24', count: 1, ...value });
  const recoverAll = () =>
    api.http().post('/api/v1/ops/recovery/run').expect(202);

  beforeAll(async () => {
    // Timeout ngắn để E11 không phải chờ 15 giây.
    Object.assign(globalThis.process.env, { HTTP_TIMEOUT_MS: '500' });
    mock = await startMock();
    api = await startApi({ listen: true, mock });
    await resetState(api, mock);
    worker = await startWorker();
  });
  beforeEach(() => resetState(api, mock, { keepQueues: true }));
  afterAll(() => stopAll(worker, api, mock));

  it('user.interaction trước khi gửi form: ghi tương tác, điểm cộng 10', async () => {
    expect(await process(samplePayload('user-interaction'))).toMatchObject({
      statusKbn: WebhookStatusKbn.PROCESSED,
    });
    expect(
      await repo(EngagementEvent).countBy({ ttclid: 'TT-abc123xyz789' }),
    ).toBe(1);
    await process(samplePayload());
    expect(
      (
        await repo(LeadSubmission).findOneByOrFail({
          externalId: 'evt_1234567890',
        })
      ).qualityScore,
    ).toBe(85);
  });

  it('E6: cùng khách gửi hai campaign: một khách, hai lượt gửi, một deal mở mỗi pipeline', async () => {
    await process(samplePayload());
    await process(samplePayload('lead-other-campaign'));
    expect(await repo(Lead).count()).toBe(1);
    expect(await repo(LeadSubmission).count()).toBe(2);
    const deals = await repo(Deal).find();
    expect(
      deals.filter((d) => d.statusKbn === DealStatusKbn.OPEN),
    ).toHaveLength(1);
    // Lượt gửi thứ hai gắn vào deal đang mở.
    expect(
      new Set((await repo(LeadSubmission).find()).map((s) => s.dealUuid)),
    ).toEqual(new Set([deals[0].uuid]));
  });

  it('E11: timeout khi tạo deal sau khi Bitrix24 đã tạo: lần thử lại tìm thấy deal, không tạo trùng', async () => {
    fault({
      error: 'timeout',
      method: 'crm.item.add',
      entityTypeId: ENTITY_DEAL,
      after: true,
    });
    expect(await process(samplePayload())).toMatchObject({
      statusKbn: WebhookStatusKbn.PROCESSED,
    });
    expect(mock.store.itemsOf(ENTITY_DEAL).size).toBe(1);
    expect((await repo(Deal).findOneByOrFail({})).bitrix24Id).toBe(
      [...mock.store.itemsOf(ENTITY_DEAL).keys()][0],
    );
  });

  it('E17: webhook Bitrix24 cho deal không do ứng dụng tạo: bỏ qua, 60011', async () => {
    await sendBitrix(api.http, 99999).expect(200);
    const event = await waitFor(() =>
      repo(WebhookEvent).findOneBy({
        bitrixDealId: 99999,
        statusKbn: WebhookStatusKbn.PROCESSED,
      }),
    );
    expect(event.errorKbn).toBe(ErrorKbn.DEAL_NOT_OWNED);
  });

  it('E18: TikTok Events API lỗi: lead, deal vẫn lên CRM; recovery gửi lại conversion, không tạo lại lead, deal', async () => {
    mock.faults.add({ service: 'tiktok', error: '500', count: 10 });
    const failed = await process(samplePayload());
    expect(failed).toMatchObject({
      statusKbn: WebhookStatusKbn.FAILED,
      currentStepKbn: JobStepKbn.CONVERSION,
    });
    expect((await repo(Deal).findOneByOrFail({})).bitrix24Id).not.toBeNull();

    mock.faults.clear();
    await recoverAll();
    await waitFor(() =>
      repo(WebhookEvent).findOneBy({
        eventId: 'evt_1234567890',
        statusKbn: WebhookStatusKbn.PROCESSED,
      }),
    );
    expect(
      await repo(ConversionEvent).findOneByOrFail({
        eventKbn: ConversionKbn.DEAL_CREATED,
      }),
    ).toMatchObject({ statusKbn: StatusKbn.SUCCESS });
    expect(mock.calls.list('bitrix24', 'crm.lead.add')).toHaveLength(1);
    expect(mock.store.itemsOf(ENTITY_DEAL).size).toBe(1);
  });

  it('E22: email của khách mới đã được sales gắn vào lead khác trên CRM: tạo lead mới, ghi nghi trùng', async () => {
    await process(samplePayload());
    const first = await repo(Lead).findOneByOrFail({});
    await fetch(
      `http://127.0.0.1:${mock.config.port}/_mock/bitrix/leads/${first.bitrix24Id}/emails`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'b@y.vn' }),
      },
    );

    await process(
      leadPayload('evt_e22', {
        lead_data: {
          full_name: 'Trần B',
          email: 'b@y.vn',
          phone: '0912222222',
        },
      }),
    );
    const submission = await repo(LeadSubmission).findOneByOrFail({
      externalId: 'evt_e22',
    });
    expect(submission.syncStatusKbn).toBe(StatusKbn.SUCCESS);
    expect(submission.warnings.map((w) => w.code)).toContain(
      WARNING.DUPLICATE_SUSPECT,
    );
    expect(mock.store.leads.size).toBe(2);
  });

  it('E25: Bitrix24 từ chối comment timeline: lượt gửi vẫn synced, có cảnh báo, deal vẫn tạo', async () => {
    fault({ error: 'ACCESS_DENIED', method: 'crm.timeline.comment.add' });
    expect(await process(samplePayload())).toMatchObject({
      statusKbn: WebhookStatusKbn.PROCESSED,
    });
    const submission = await repo(LeadSubmission).findOneByOrFail({});
    expect(submission.syncStatusKbn).toBe(StatusKbn.SUCCESS);
    expect(submission.warnings.map((w) => w.code)).toContain(
      WARNING.COMMENT_REJECTED,
    );
    expect(submission.dealUuid).not.toBeNull();
  });

  it('E26: hết lượt thử sau khi deal đã lên CRM: recovery chạy tiếp từ bước 6c, không trùng', async () => {
    fault({ error: '500', method: 'crm.lead.update', count: 10 });
    const failed = await process(samplePayload());
    expect(failed).toMatchObject({
      statusKbn: WebhookStatusKbn.FAILED,
      currentStepKbn: JobStepKbn.LEAD_CONVERTED,
    });

    mock.faults.clear();
    await recoverAll();
    await waitFor(() =>
      repo(WebhookEvent).findOneBy({
        eventId: 'evt_1234567890',
        statusKbn: WebhookStatusKbn.PROCESSED,
      }),
    );
    expect(mock.calls.list('bitrix24', 'crm.lead.add')).toHaveLength(1);
    expect(mock.store.itemsOf(ENTITY_DEAL).size).toBe(1);
    expect(mock.store.notifications).toHaveLength(1);
    const lead = await repo(Lead).findOneByOrFail({});
    expect(mock.store.leads.get(lead.bitrix24Id!)).toMatchObject({
      STATUS_ID: 'CONVERTED',
    });
  });

  it('E32: sales xóa lead trên CRM rồi khách gửi lại: tạo lead mới, ghi lead cũ không còn', async () => {
    await process(samplePayload());
    const lead = await repo(Lead).findOneByOrFail({});
    mock.store.leads.delete(lead.bitrix24Id!);

    expect(await process(leadPayload('evt_e32'))).toMatchObject({
      statusKbn: WebhookStatusKbn.PROCESSED,
    });
    const after = await repo(Lead).findOneByOrFail({});
    expect(after.bitrix24Id).not.toBe(lead.bitrix24Id);
    const submission = await repo(LeadSubmission).findOneByOrFail({
      externalId: 'evt_e32',
    });
    expect(submission.warnings.map((w) => w.code)).toContain(WARNING.LEAD_GONE);
    // Lượt gửi gắn vào deal đang mở, nên lead mới cũng được chuyển CONVERTED.
    expect(after.statusKbn).toBe(LeadStatusKbn.CONVERTED);
    expect(mock.store.leads.get(after.bitrix24Id!)).toMatchObject({
      STATUS_ID: 'CONVERTED',
    });
  });

  it('Contact có sẵn trên CRM (sales tạo, chỉ có email): dùng Contact đó, thêm SĐT còn thiếu, giữ tên', async () => {
    const created = (await fetch(
      `${globalThis.process.env.BITRIX24_WEBHOOK_URL}/crm.item.add`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityTypeId: ENTITY_CONTACT,
          fields: {
            name: 'Anh A (sales nhập)',
            fm: [
              {
                typeId: 'EMAIL',
                valueType: 'WORK',
                value: 'nguyenvana@email.com',
              },
            ],
          },
        }),
      },
    ).then((r) => r.json())) as { result: { item: { id: number } } };
    const contactId = created.result.item.id;

    await process(samplePayload());
    const lead = await repo(Lead).findOneByOrFail({});
    expect(lead.bitrixContactId).toBe(contactId);
    expect(mock.store.itemsOf(ENTITY_CONTACT).size).toBe(1);
    const contact = mock.store.itemsOf(ENTITY_CONTACT).get(contactId)!;
    expect(contact.name).toBe('Anh A (sales nhập)');
    expect(
      (contact.fm as { typeId: string; value: string }[]).map(
        (v) => `${v.typeId}:${v.value}`,
      ),
    ).toEqual(['EMAIL:nguyenvana@email.com', 'PHONE:+84901234567']);
  });

  it('TikTok gửi lại sự kiện đã FAILED: job ở dead letter queue được chạy lại', async () => {
    fault({ error: 'ACCESS_DENIED', method: 'crm.lead.add' });
    expect((await process(samplePayload())).statusKbn).toBe(
      WebhookStatusKbn.FAILED,
    );

    const res = await sendTiktok(api.http, samplePayload()).expect(200);
    expect(res.body).toMatchObject({ duplicate: true });
    await waitFor(() =>
      repo(WebhookEvent).findOneBy({
        eventId: 'evt_1234567890',
        statusKbn: WebhookStatusKbn.PROCESSED,
      }),
    );
    expect(mock.store.leads.size).toBe(1);
  });

  it('sales chuyển deal sang pipeline khác: cập nhật pipeline_id; pipeline đích đã có deal mở của khách thì giữ pipeline cũ', async () => {
    const moveDeal = (id: number, body: object) =>
      fetch(
        `http://127.0.0.1:${mock.config.port}/_mock/bitrix/deals/${id}/stage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
    // Campaign "Summer" vào pipeline 0, còn lại như mặc định (pipeline 1).
    const rules = (await api.http().get('/api/v1/config/rules').expect(200))
      .body as Record<string, any>;
    await api
      .http()
      .put('/api/v1/config/rules')
      .send({
        deal_rules: [
          {
            condition: "campaign.campaign_name CONTAINS 'summer'",
            action: 'create_deal',
            pipeline_id: '0',
            stage_id: 'NEW',
          },
          ...rules.deal_rules,
        ],
        stage_probability: {
          ...rules.stage_probability,
          '0': { NEW: 20, WON: 100, LOSE: 0 },
        },
        assignment_rules: rules.assignment_rules,
        version: rules.version,
      })
      .expect(200);

    await process(samplePayload());
    const spring = await repo(Deal).findOneByOrFail({});
    await moveDeal(spring.bitrix24Id!, { category_id: 0 });
    await waitFor(() =>
      repo(Deal).findOneBy({ uuid: spring.uuid, pipelineId: '0' }),
    );
    expect(
      await repo(Deal).findOneByOrFail({ uuid: spring.uuid }),
    ).toMatchObject({ stage: 'NEW', statusKbn: DealStatusKbn.OPEN });

    // Chuyển lại pipeline 1, rồi khách gửi campaign Summer: deal mở thứ hai ở pipeline 0.
    await moveDeal(spring.bitrix24Id!, { category_id: 1 });
    await waitFor(() =>
      repo(Deal).findOneBy({ uuid: spring.uuid, pipelineId: '1' }),
    );
    await process(samplePayload('lead-other-campaign'));
    const summer = await repo(Deal).findOneByOrFail({ pipelineId: '0' });

    const before = await repo(WebhookEvent).countBy({
      eventName: 'ONCRMDEALUPDATE',
    });
    await moveDeal(spring.bitrix24Id!, { category_id: 0 });
    await waitFor(async () => {
      const rows = await repo(WebhookEvent).findBy({
        eventName: 'ONCRMDEALUPDATE',
      });
      return rows.length > before && rows.every((r) => DONE.has(r.statusKbn));
    });
    expect(
      await repo(Deal).findOneByOrFail({ uuid: spring.uuid }),
    ).toMatchObject({ pipelineId: '1', statusKbn: DealStatusKbn.OPEN });
    expect(
      (await repo(Deal).findOneByOrFail({ uuid: summer.uuid })).statusKbn,
    ).toBe(DealStatusKbn.OPEN);
  });

  it('E34: deal mở bị xóa trên CRM mà webhook không tới: deal cũ DELETED, tạo deal mới', async () => {
    await process(samplePayload());
    const old = await repo(Deal).findOneByOrFail({});
    mock.store.itemsOf(ENTITY_DEAL).delete(old.bitrix24Id!);

    await process(leadPayload('evt_e34'));
    expect(
      (await repo(Deal).findOneByOrFail({ uuid: old.uuid })).statusKbn,
    ).toBe(DealStatusKbn.DELETED);
    expect(await repo(Deal).countBy({ statusKbn: DealStatusKbn.OPEN })).toBe(1);
  });

  it('deal bị xóa trên CRM, webhook ONCRMDEALDELETE tới: deal DELETED', async () => {
    await process(samplePayload());
    const deal = await repo(Deal).findOneByOrFail({});
    mock.store.itemsOf(ENTITY_DEAL).delete(deal.bitrix24Id!);
    await sendBitrix(api.http, deal.bitrix24Id!, 'ONCRMDEALDELETE').expect(200);
    await waitFor(() =>
      repo(Deal).findOneBy({
        uuid: deal.uuid,
        statusKbn: DealStatusKbn.DELETED,
      }),
    );
  });

  it('sales đổi stage trên CRM: xác suất theo stage; mở lại deal đã thắng khi khách có deal mở khác thì giữ trạng thái', async () => {
    const moveDeal = (id: number, stage_id: string) =>
      fetch(
        `http://127.0.0.1:${mock.config.port}/_mock/bitrix/deals/${id}/stage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage_id }),
        },
      );
    // Mỗi lần kéo deal sinh hai webhook: đổi stage, rồi ứng dụng cập nhật xác
    // suất lên CRM làm Bitrix24 gửi thêm một cái. Chờ tới khi mọi sự kiện đã
    // xử lý xong và không có sự kiện mới trong 300 ms.
    const settleBitrixEvents = async () => {
      let seen = -1;
      await waitFor(async () => {
        const rows = await repo(WebhookEvent).findBy({
          eventName: 'ONCRMDEALUPDATE',
        });
        const quiet =
          rows.length === seen && rows.every((r) => DONE.has(r.statusKbn));
        seen = rows.length;
        if (!quiet) await new Promise((resolve) => setTimeout(resolve, 300));
        return quiet;
      });
    };

    await process(samplePayload());
    const first = await repo(Deal).findOneByOrFail({});
    await moveDeal(first.bitrix24Id!, 'C1:PREPARATION');
    await settleBitrixEvents();
    expect(
      await repo(Deal).findOneByOrFail({ uuid: first.uuid }),
    ).toMatchObject({ stage: 'C1:PREPARATION', probability: 50 });
    expect(
      mock.store.itemsOf(ENTITY_DEAL).get(first.bitrix24Id!),
    ).toMatchObject({ probability: 50 });

    await moveDeal(first.bitrix24Id!, 'C1:WON');
    await settleBitrixEvents();
    expect(
      (await repo(Deal).findOneByOrFail({ uuid: first.uuid })).statusKbn,
    ).toBe(DealStatusKbn.WON);
    await process(leadPayload('evt_reopen'));
    const second = await repo(Deal).findOneByOrFail({
      statusKbn: DealStatusKbn.OPEN,
    });

    await moveDeal(first.bitrix24Id!, 'C1:NEW');
    await settleBitrixEvents();
    expect(
      await repo(Deal).findOneByOrFail({ uuid: first.uuid }),
    ).toMatchObject({ stage: 'C1:NEW', statusKbn: DealStatusKbn.WON });
    expect(
      (await repo(Deal).findOneByOrFail({ uuid: second.uuid })).statusKbn,
    ).toBe(DealStatusKbn.OPEN);
  });

  it('chuyển tay: lượt gửi không khớp rule thành deal; gửi lần nữa thì 409 (E15)', async () => {
    const payload = samplePayload('lead-other-campaign');
    (payload.campaign as Record<string, unknown>).campaign_name =
      'Brand Awareness';
    await process(payload);
    expect(await repo(Deal).count()).toBe(0);
    const lead = await repo(Lead).findOneByOrFail({});

    const res = await api
      .http()
      .post(`/api/v1/leads/${lead.uuid}/convert-to-deal`)
      .send({ stage_id: 'PREPARATION', assigned_to: 9 })
      .expect(202);
    const deal = await waitFor(
      () =>
        repo(Deal)
          .findOneBy({ uuid: res.body.dealUuid as string })
          .then((d) => (d?.bitrix24Id ? d : null)),
      15_000,
      'deal chuyển tay lên CRM',
    );
    // Stage PREPARATION 50, cộng 10 vì điểm 75 ≥ 70 (mục 6.3).
    expect(deal).toMatchObject({
      stage: 'C1:PREPARATION',
      assignedTo: 9,
      probability: 60,
    });
    expect(mock.store.itemsOf(ENTITY_DEAL).get(deal.bitrix24Id!)).toMatchObject(
      { stageId: 'C1:PREPARATION', assignedById: 9 },
    );

    const again = await api
      .http()
      .post(`/api/v1/leads/${lead.uuid}/convert-to-deal`)
      .send({})
      .expect(409);
    expect(again.body.errorKbn).toBe(ErrorKbn.SUBMISSION_HAS_DEAL);
  });

  it('E31: hết số vòng chạy lại thì batch bỏ qua; chạy lại đúng sự kiện đó thì đặt lại số vòng', async () => {
    fault({ error: '500', method: 'crm.lead.add', count: 1000 });
    const failed = await process(samplePayload());
    expect(failed.statusKbn).toBe(WebhookStatusKbn.FAILED);
    // Giả đã chạy đủ 3 vòng.
    await repo(WebhookEvent).update({ uuid: failed.uuid }, { retryCount: 3 });
    mock.faults.clear();
    await recoverAll();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(
      await repo(WebhookEvent).findOneByOrFail({ uuid: failed.uuid }),
    ).toMatchObject({ statusKbn: WebhookStatusKbn.FAILED, retryCount: 3 });

    await api
      .http()
      .post(`/api/v1/ops/recovery/run?webhook_event_uuid=${failed.uuid}`)
      .expect(202);
    const done = await waitFor(() =>
      repo(WebhookEvent).findOneBy({
        uuid: failed.uuid,
        statusKbn: WebhookStatusKbn.PROCESSED,
      }),
    );
    expect(done.retryCount).toBe(1);
  });

  it('sự kiện mất job (Redis mất dữ liệu): recovery thêm lại job với đúng jobId', async () => {
    await process(samplePayload());
    const processed = await repo(WebhookEvent).findOneByOrFail({
      eventId: 'evt_1234567890',
    });
    // Dòng RECEIVED không có job trong queue.
    const lost = await repo(WebhookEvent).save(
      repo(WebhookEvent).create({
        ...processed,
        uuid: undefined,
        eventId: 'evt_lost',
        payload: leadPayload('evt_lost'),
        statusKbn: WebhookStatusKbn.RECEIVED,
        leadSubmissionUuid: null,
      }),
    );
    // Sự kiện đã xong thì chạy lại theo uuid không làm gì.
    await api
      .http()
      .post(`/api/v1/ops/recovery/run?webhook_event_uuid=${processed.uuid}`)
      .expect(202);
    await recoverAll();
    const done = await waitFor(() =>
      repo(WebhookEvent).findOneBy({
        uuid: lost.uuid,
        statusKbn: WebhookStatusKbn.PROCESSED,
      }),
    );
    expect(done.retryCount).toBe(1);
    expect(
      (await repo(WebhookEvent).findOneByOrFail({ uuid: processed.uuid }))
        .retryCount,
    ).toBe(0);
  });

  it('E36: deal mở đã thắng trên CRM mà webhook không tới: deal cũ won, lượt gửi mới có deal mới', async () => {
    await process(samplePayload());
    const old = await repo(Deal).findOneByOrFail({});
    const crmDeal = mock.store.itemsOf(ENTITY_DEAL).get(old.bitrix24Id!)!;
    Object.assign(crmDeal, { stageId: 'C1:WON', stageSemanticId: 'S' });

    await process(leadPayload('evt_e36'));
    expect(
      (await repo(Deal).findOneByOrFail({ uuid: old.uuid })).statusKbn,
    ).toBe(DealStatusKbn.WON);
    const fresh = await repo(LeadSubmission).findOneByOrFail({
      externalId: 'evt_e36',
    });
    expect(fresh.dealUuid).not.toBe(old.uuid);
  });
});
