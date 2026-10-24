import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash } from 'node:crypto';
import {
  DealStatusKbn,
  StatusKbn,
  WebhookStatusKbn,
} from '../../src/common/kbn/status.kbn';
import { ErrorKbn } from '../../src/common/kbn/error.kbn';
import { CoreModule } from '../../src/core.module';
import { Deal } from '../../src/deals/entities/deal.entity';
import { ImportsModule } from '../../src/imports/imports.module';
import { HistoryImportService } from '../../src/imports/services/history-import.service';
import { Lead } from '../../src/leads/entities/lead.entity';
import { LeadSubmission } from '../../src/leads/entities/lead-submission.entity';
import {
  ENTITY_CONTACT,
  ENTITY_DEAL,
} from '../../src/mock/bitrix/bitrix-mock.store';
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
import { leadPayload, sendTiktok, waitFor } from '../helpers/tiktok';

/** Như module của npm run import:history. */
@Module({
  imports: [CoreModule.forRoot({ runMigrations: false }), ImportsModule],
})
class ImportScriptModule {}

const DONE = new Set<number>([
  WebhookStatusKbn.PROCESSED,
  WebhookStatusKbn.FAILED,
  WebhookStatusKbn.INVALID,
]);
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/**
 * Chạy hết luồng demo của đề (readme_api.md mục 11.1, TS1–TS9) và vài lỗi ở
 * mục 10, với api, worker, Bitrix24/TikTok giả trong cùng process. Các bước
 * nối tiếp nhau (TS4 dùng dữ liệu của TS1–TS3), nên chạy theo thứ tự.
 */
describe('Luồng demo (E2E)', () => {
  let mock: MockHandle;
  let api: ApiHandle;
  let worker: INestApplicationContext;
  const repo = <T extends object>(entity: new () => T) =>
    api.dataSource.getRepository(entity);
  const mockHttp = (path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${mock.config.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => r.json() as Promise<Record<string, unknown>>);

  /** Chờ sự kiện xử lý xong (PROCESSED, FAILED hoặc INVALID). */
  const settled = (eventId: string, timeoutMs = 15_000) =>
    waitFor(
      async () => {
        const event = await repo(WebhookEvent).findOneBy({ eventId });
        return event && DONE.has(event.statusKbn) ? event : null;
      },
      timeoutMs,
      `${eventId} xử lý xong`,
    );

  const leadByEmail = (email: string) => repo(Lead).findOneByOrFail({ email });

  beforeAll(async () => {
    mock = await startMock();
    api = await startApi({ listen: true, mock });
    await resetState(api, mock);
    worker = await startWorker();
  });
  afterAll(() => stopAll(worker, api, mock));

  it('TS1, TS2: nhận webhook, tạo lead Bitrix24 theo mapping, comment timeline', async () => {
    await sendTiktok(api.http, samplePayload()).expect(200);
    expect(await settled('evt_1234567890')).toMatchObject({
      statusKbn: WebhookStatusKbn.PROCESSED,
    });

    const list = await api
      .http()
      .get('/api/v1/leads?q=nguyenvana@email.com')
      .expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        qualityScore: 75,
        latestSubmission: expect.objectContaining({
          syncStatus: 'synced',
        }) as object,
      }),
    ]);

    const [add] = mock.calls.list('bitrix24', 'crm.lead.add');
    expect(
      (add.params as { fields: Record<string, unknown> }).fields,
    ).toMatchObject({
      NAME: 'Nguyễn Văn A',
      EMAIL: [{ VALUE: 'nguyenvana@email.com', VALUE_TYPE: 'WORK' }],
      PHONE: [{ VALUE: '+84901234567', VALUE_TYPE: 'WORK' }],
      UF_CRM_CITY: 'Hà Nội',
      UF_CRM_UTM_CAMPAIGN: 'Spring Sale 2024',
      SOURCE_ID: 'TIKTOK',
      UF_CRM_SOURCES: ['TikTok'],
    });
    expect(
      mock.store.comments.some((c) =>
        c.COMMENT.includes('Campaign: Spring Sale 2024'),
      ),
    ).toBe(true);
  });

  it('TS3: rule khớp, tạo Contact và deal, lead CONVERTED, báo sales', async () => {
    const lead = await leadByEmail('nguyenvana@email.com');
    const deals = await api.http().get('/api/v1/deals').expect(200);
    expect(deals.body.data).toEqual([
      expect.objectContaining({
        stage: 'C1:NEW',
        probability: 40,
        assignedTo: 7,
        amount: 7_500_000,
        status: 'open',
      }),
    ]);
    const dealId = deals.body.data[0].bitrix24Id as number;
    const item = mock.store.itemsOf(ENTITY_DEAL).get(dealId);
    expect(item).toMatchObject({
      leadId: lead.bitrix24Id,
      contactIds: [lead.bitrixContactId],
    });
    expect(mock.store.itemsOf(ENTITY_CONTACT).size).toBe(1);
    expect(mock.store.leads.get(lead.bitrix24Id!)).toMatchObject({
      STATUS_ID: 'CONVERTED',
    });
    expect(mock.store.notifications.map((n) => n.USER_ID)).toContain(7);
  });

  it('TS7: sales kéo deal sang thắng, webhook Bitrix24 về, deal won, báo TikTok', async () => {
    const deal = await repo(Deal).findOneByOrFail({
      statusKbn: DealStatusKbn.OPEN,
    });
    await mockHttp(`/_mock/bitrix/deals/${deal.bitrix24Id}/stage`, {
      stage_id: 'C1:WON',
      opportunity: 8_000_000,
    });
    const won = await waitFor(
      () =>
        repo(Deal).findOneBy({ uuid: deal.uuid, statusKbn: DealStatusKbn.WON }),
      15_000,
      'deal won',
    );
    expect(won).toMatchObject({
      probability: 100,
      amount: 8_000_000,
      stage: 'C1:WON',
    });

    const conversion = await waitFor(
      () =>
        mock.calls
          .list('tiktok')
          .find((c) => JSON.stringify(c.body).includes('deal_won')),
      15_000,
      'conversion deal_won',
    );
    const [data] = (
      conversion.body as {
        data: { lead: { lead_id: string }; user: { email: string[] } }[];
      }
    ).data;
    expect(data.lead.lead_id).toBe('evt_1234567890');
    expect(data.user.email).toEqual([sha256('nguyenvana@email.com')]);
  });

  it('E21: form.complete cùng form: một lượt gửi, câu trả lời gộp, giữ deal, không đổi khi gửi lại', async () => {
    const comments = mock.store.comments.length;
    await sendTiktok(api.http, samplePayload('form-complete')).expect(200);
    await settled('evt_1234567891');
    const submissions = await repo(LeadSubmission).find({
      where: { email: 'nguyenvana@email.com' },
    });
    expect(submissions).toHaveLength(1);
    expect(submissions[0].completedAt).not.toBeNull();
    expect(submissions[0].answers.map((a) => a.slug)).toEqual([
      'budget_range',
      'timeline',
      'so_nhan_vien',
    ]);
    expect(submissions[0].dealUuid).not.toBeNull();
    expect(mock.store.comments.length).toBe(comments + 1);

    await sendTiktok(api.http, samplePayload('form-complete')).expect(200);
    expect(mock.store.comments.length).toBe(comments + 1);
  });

  it('TS4, TS5, TS6: thống kê, export, health', async () => {
    await api.dataSource.query(
      `INSERT INTO campaign_spend (campaign_id, campaign_name, spend_date, spend) VALUES ('1234567890123456789', 'Spring Sale 2024', '2024-03-08', 500000)`,
    );
    const range = 'from=2024-03-01&to=2024-03-31';
    const rates = await api
      .http()
      .get(`/api/v1/analytics/conversion-rates?${range}`)
      .expect(200);
    expect(rates.body.items[0]).toMatchObject({
      submissions: 1,
      leads: 1,
      deals: 1,
      won: 1,
      revenue: 8_000_000,
      winRate: 1,
    });
    const perf = await api
      .http()
      .get(`/api/v1/analytics/campaign-performance?${range}`)
      .expect(200);
    expect(perf.body.items[0]).toMatchObject({
      spend: 500_000,
      cpl: 500_000,
      roi: 15,
    });

    for (const format of ['csv', 'json', 'xlsx']) {
      await api
        .http()
        .get(`/api/v1/reports/export?format=${format}&${range}`)
        .expect(200);
    }
    const health = await api.http().get('/health').expect(200);
    expect(health.body).toMatchObject({
      status: 'ok',
      info: { worker: { status: 'up' }, bitrix24: { status: 'up' } },
    });
  });

  it('E7: năm webhook của cùng khách tới cùng lúc: một khách, một lead Bitrix24', async () => {
    const before = mock.calls.list('bitrix24', 'crm.lead.add').length;
    const lead_data = {
      full_name: 'Phạm Văn E',
      email: 'e7@example.com',
      phone: '0912777777',
      city: 'Huế',
    };
    await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        sendTiktok(api.http, leadPayload(`evt_e7_${i}`, { lead_data })).expect(
          200,
        ),
      ),
    );
    for (let i = 1; i <= 5; i++) await settled(`evt_e7_${i}`);
    expect(await repo(Lead).countBy({ email: 'e7@example.com' })).toBe(1);
    expect(
      await repo(LeadSubmission).countBy({ email: 'e7@example.com' }),
    ).toBe(5);
    expect(mock.calls.list('bitrix24', 'crm.lead.add').length).toBe(before + 1);
  });

  it('E8: Bitrix24 quá tải ngắn: thử lại rồi thành công', async () => {
    mock.faults.add({
      service: 'bitrix24',
      error: 'QUERY_LIMIT_EXCEEDED',
      count: 2,
    });
    await sendTiktok(
      api.http,
      leadPayload('evt_e8', {
        lead_data: { email: 'e8@example.com', phone: '0912888888' },
      }),
    ).expect(200);
    const event = await settled('evt_e8');
    expect(event).toMatchObject({ statusKbn: WebhookStatusKbn.PROCESSED });
    expect(event.attemptCount).toBeGreaterThan(1);
  });

  it('E9: Bitrix24 quá tải lâu: FAILED 40009 sau 4 lần, nằm ở DLQ; tắt lỗi, chạy recovery thì xong', async () => {
    mock.faults.add({
      service: 'bitrix24',
      error: 'QUERY_LIMIT_EXCEEDED',
      count: 1000,
    });
    await sendTiktok(
      api.http,
      leadPayload('evt_e9', {
        lead_data: { email: 'e9@example.com', phone: '0912999999' },
      }),
    ).expect(200);
    const failed = await settled('evt_e9');
    expect(failed).toMatchObject({
      statusKbn: WebhookStatusKbn.FAILED,
      errorKbn: 40009,
      attemptCount: 4,
      retryCount: 0,
    });

    const dead = await api.http().get('/api/v1/ops/dead-letters').expect(200);
    expect(dead.body).toEqual([
      expect.objectContaining({
        eventId: 'evt_e9',
        currentStep: 'LEAD_SYNC',
        attemptCount: 4,
        retryCount: 0,
        retryable: true,
        jobState: 'failed',
      }),
    ]);

    mock.faults.clear();
    await api.http().post('/api/v1/ops/recovery/run').expect(202);
    const recovered = await waitFor(
      () =>
        repo(WebhookEvent).findOneBy({
          eventId: 'evt_e9',
          statusKbn: WebhookStatusKbn.PROCESSED,
        }),
      15_000,
      'evt_e9 chạy lại xong',
    );
    expect(recovered.retryCount).toBe(1);
    expect(
      (await repo(LeadSubmission).findOneByOrFail({ externalId: 'evt_e9' }))
        .syncStatusKbn,
    ).toBe(StatusKbn.SUCCESS);
  });

  it('E10: Bitrix24 từ chối quyền: FAILED 40003, không thử lại; cảnh báo SYNC_FAILED chỉ ghi nhận, không gửi lên Bitrix24', async () => {
    const notifications = mock.store.notifications.length;
    mock.faults.add({ service: 'bitrix24', error: 'ACCESS_DENIED', count: 1 });
    await sendTiktok(
      api.http,
      leadPayload('evt_e10', {
        lead_data: { email: 'e10@example.com', phone: '0912101010' },
      }),
    ).expect(200);
    expect(await settled('evt_e10')).toMatchObject({
      statusKbn: WebhookStatusKbn.FAILED,
      errorKbn: 40003,
      attemptCount: 1,
    });
    const alerts = await api
      .http()
      .get('/api/v1/alerts?type=sync_failed')
      .expect(200);
    expect(alerts.body.data).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('40003') as string,
      }),
    ]);
    expect(mock.store.notifications).toHaveLength(notifications);
  });

  it('E4: không có email lẫn SĐT hợp lệ: INVALID 20014', async () => {
    await sendTiktok(api.http, samplePayload('lead-invalid')).expect(200);
    expect(await settled('evt_invalid_0001')).toMatchObject({
      statusKbn: WebhookStatusKbn.INVALID,
      errorKbn: ErrorKbn.NO_CONTACT_INFO,
    });
  });

  it('TS9: nhập dữ liệu cũ; khách mẫu có thêm nguồn Facebook', async () => {
    const script = await NestFactory.createApplicationContext(
      ImportScriptModule,
      { logger: false },
    );
    try {
      const result = await script
        .get(HistoryImportService)
        .run('samples/history/leads-2025.json');
      expect(result).toMatchObject({ total: 19, enqueued: 19 });
    } finally {
      await script.close();
    }
    await waitFor(
      async () => {
        const [{ pending }] = await api.dataSource.query<{ pending: number }[]>(
          `SELECT count(*)::int AS pending FROM webhook_events WHERE event_id LIKE 'import-%' AND status_kbn NOT IN (${[...DONE].join(',')})`,
        );
        return pending === 0;
      },
      30_000,
      'import xử lý xong',
    );
    const lead = await leadByEmail('nguyenvana@email.com');
    const detail = await api
      .http()
      .get(`/api/v1/leads/${lead.uuid}`)
      .expect(200);
    expect(detail.body.sources).toEqual(
      expect.arrayContaining(['tiktok', 'facebook']),
    );
    expect(mock.store.leads.get(lead.bitrix24Id!)?.UF_CRM_SOURCES).toEqual([
      'TikTok',
      'Facebook',
    ]);
    const [row] = await api.dataSource.query<{ total: number }[]>(
      `SELECT total FROM imports`,
    );
    expect(row.total).toBe(19);
  });

  it('nhập lại cùng tệp: bản ghi đã xử lý không đẩy job lại; tệp không phải mảng thì lỗi', async () => {
    const script = await NestFactory.createApplicationContext(
      ImportScriptModule,
      { logger: false },
    );
    try {
      const again = await script
        .get(HistoryImportService)
        .run('samples/history/leads-2025.json');
      expect(again).toMatchObject({ total: 19, enqueued: 0 });
      await expect(
        script
          .get(HistoryImportService)
          .run('seeds/configurations/alert_rules.json'),
      ).rejects.toThrow();
    } finally {
      await script.close();
    }
    expect(
      await repo(LeadSubmission).countBy({ email: 'nguyenvana@email.com' }),
    ).toBe(2);
  });
});
