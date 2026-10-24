import { AlertService } from '../../src/analytics/services/alert.service';
import { DealStatusKbn, StatusKbn } from '../../src/common/kbn/status.kbn';
import { ErrorKbn } from '../../src/common/kbn/error.kbn';
import { AlertTypeKbn, SourceKbn } from '../../src/common/kbn/type.kbn';
import { localDate } from '../../src/common/query/date-range';
import {
  resetState,
  startApi,
  stopAll,
  type ApiHandle,
} from '../helpers/harness';
import { seedCustomer } from '../helpers/seed';

/** Xóa các khóa Redis theo mẫu (cache thống kê, bộ đếm throttle). */
async function clearKeys(api: ApiHandle, pattern: string): Promise<void> {
  const keys = await api.redis.keys(pattern);
  if (keys.length) await api.redis.del(...keys);
}

/** Đọc body nhị phân (xlsx) thành Buffer. */
function binary(
  res: unknown,
  callback: (error: Error | null, body: Buffer) => void,
) {
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Thống kê, báo cáo (integration)', () => {
  let api: ApiHandle;
  const now = new Date();
  const today = localDate(now, 'Asia/Ho_Chi_Minh');

  beforeAll(async () => {
    api = await startApi();
    await resetState(api);
    // Campaign Spring Sale: 2 khách, 3 lượt gửi, 1 deal thắng 10 triệu, chi phí 1 triệu.
    const first = { firstSubmittedAt: now, lastSubmittedAt: now };
    await seedCustomer(api.dataSource, {
      lead: { email: 'a@x.vn', phone: '+84900000001', ...first },
      submissions: [
        { submittedAt: now },
        { submittedAt: now, qualityScore: 55 },
      ],
      deals: [
        {
          statusKbn: DealStatusKbn.WON,
          stage: 'C1:WON',
          amount: 10_000_000,
          closedAt: now,
          bitrix24Id: 1,
        },
      ],
    });
    await seedCustomer(api.dataSource, {
      lead: { name: 'B', email: 'b@x.vn', phone: '+84900000002', ...first },
      submissions: [
        { submittedAt: now, qualityScore: 35, syncStatusKbn: StatusKbn.FAILED },
      ],
    });
    // Campaign Facebook: 1 khách, deal thua.
    await seedCustomer(api.dataSource, {
      lead: { name: 'C', email: 'c@x.vn', phone: '+84900000003', ...first },
      submissions: [
        {
          submittedAt: now,
          channelKbn: SourceKbn.FACEBOOK,
          campaignId: '777',
          campaignName: 'FB Q1',
          adId: 'ad2',
          formId: 'f2',
        },
      ],
      deals: [
        {
          statusKbn: DealStatusKbn.LOST,
          stage: 'C1:LOSE',
          amount: 3_000_000,
          closedAt: now,
        },
      ],
    });
    await api.dataSource.query(
      `INSERT INTO campaign_spend (campaign_id, campaign_name, spend_date, spend, impressions, clicks)
       VALUES ('1234567890123456789', 'Spring Sale 2024', $1, 1000000, 20000, 300)`,
      [today],
    );
  });
  afterAll(() => stopAll(api));

  it('conversion-rates theo campaign: công thức mục 9.2, tổng đếm khách DISTINCT', async () => {
    const res = await api
      .http()
      .get('/api/v1/analytics/conversion-rates?date_range=7d')
      .expect(200);
    expect(res.body).toMatchObject({
      groupBy: 'campaign',
      range: { to: today, timezone: 'Asia/Ho_Chi_Minh' },
    });
    const spring = (res.body.items as { key: { campaignId: string } }[]).find(
      (i) => i.key.campaignId === '1234567890123456789',
    );
    expect(spring).toMatchObject({
      key: { campaignName: 'Spring Sale 2024' },
      submissions: 3,
      leads: 2,
      deals: 1,
      won: 1,
      lost: 0,
      leadToDeal: 0.5,
      leadToWon: 0.5,
      winRate: 1,
      revenue: 10_000_000,
      avgQualityScore: 55,
    });
    expect(res.body.totals).toMatchObject({
      submissions: 4,
      leads: 3,
      deals: 2,
      won: 1,
      lost: 1,
    });
    expect(res.body.cachedAt).toBeDefined();
  });

  it.each([
    ['ad', (key: Record<string, unknown>) => key.adId === 'ad2'],
    ['form', (key: Record<string, unknown>) => key.formId === 'f2'],
    [
      'event_type',
      (key: Record<string, unknown>) => key.eventType === 'lead.generate',
    ],
    ['day', (key: Record<string, unknown>) => key.day === today],
  ])('group_by=%s', async (groupBy, matchKey) => {
    const res = await api
      .http()
      .get(
        `/api/v1/analytics/conversion-rates?group_by=${groupBy}&date_range=30d`,
      )
      .expect(200);
    expect(
      (res.body.items as { key: Record<string, unknown> }[]).some((i) =>
        matchKey(i.key),
      ),
    ).toBe(true);
  });

  it('lọc theo campaign; tham số sai thì 400', async () => {
    const res = await api
      .http()
      .get(
        `/api/v1/analytics/conversion-rates?campaign_id=777&from=${today}&to=${today}`,
      )
      .expect(200);
    expect(res.body.totals).toMatchObject({
      submissions: 1,
      leads: 1,
      lost: 1,
    });
    await api
      .http()
      .get('/api/v1/analytics/conversion-rates?group_by=x')
      .expect(400);
    await api
      .http()
      .get('/api/v1/analytics/conversion-rates?from=2026-13-01')
      .expect(400);
  });

  it('campaign-performance: chi phí, CPL, ROI; không có chi phí thì null', async () => {
    const res = await api
      .http()
      .get('/api/v1/analytics/campaign-performance?date_range=30d')
      .expect(200);
    const items = res.body.items as Record<string, unknown>[];
    expect(
      items.find((i) => i.campaignId === '1234567890123456789'),
    ).toMatchObject({
      spend: 1_000_000,
      impressions: 20000,
      clicks: 300,
      submissions: 3,
      leads: 2,
      cpl: 333_333,
      costPerCustomer: 500_000,
      costPerWon: 1_000_000,
      revenue: 10_000_000,
      roi: 9,
    });
    expect(items.find((i) => i.campaignId === '777')).toMatchObject({
      spend: null,
      cpl: null,
      roi: null,
    });
  });

  it('overview: hôm nay, 7 ngày, top campaign, đồng bộ, cảnh báo', async () => {
    await api.app
      .get(AlertService)
      .raise(AlertTypeKbn.SYNC_FAILED, 'x', 'lỗi đồng bộ');
    await clearKeys(api, 'analytics:overview*');
    const res = await api.http().get('/api/v1/analytics/overview').expect(200);
    expect(res.body).toMatchObject({
      today: {
        submissions: 4,
        newLeads: 3,
        deals: 2,
        won: 1,
        revenue: 10_000_000,
      },
      last7Days: { submissions: 4 },
      sync: { pending: 0, failed: 1 },
      deadLetters: 0,
      alerts: [expect.objectContaining({ typeKbn: AlertTypeKbn.SYNC_FAILED })],
    });
    expect(res.body.topCampaigns[0]).toMatchObject({
      campaignId: '1234567890123456789',
      leads: 2,
    });
  });

  it('alerts, reports', async () => {
    const alerts = await api
      .http()
      .get('/api/v1/alerts?type=sync_failed')
      .expect(200);
    expect(alerts.body.data).toEqual([
      expect.objectContaining({
        type: 'sync_failed',
        subject: 'x',
        message: 'lỗi đồng bộ',
      }),
    ]);

    const [report] = await api.dataSource.query<{ uuid: string }[]>(
      `INSERT INTO reports (type, period_start, period_end, payload) VALUES ('daily', $1, $1, '{"submissions":4}') RETURNING uuid`,
      [today],
    );
    expect(
      (await api.http().get('/api/v1/reports').expect(200)).body.data,
    ).toEqual([expect.objectContaining({ uuid: report.uuid, type: 'daily' })]);
    expect(
      (await api.http().get(`/api/v1/reports/${report.uuid}`).expect(200)).body
        .payload,
    ).toEqual({ submissions: 4 });
    await api
      .http()
      .get('/api/v1/reports/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });

  describe('GET /api/v1/reports/export', () => {
    beforeEach(() => clearKeys(api, 'throttle:*'));

    it('CSV có BOM, đúng cột, tên tệp theo khoảng ngày', async () => {
      const res = await api
        .http()
        .get('/api/v1/reports/export?format=csv&date_range=30d')
        .expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(
        /filename="submissions-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"/,
      );
      const lines = res.text.split('\r\n').filter(Boolean);
      expect(lines[0].charCodeAt(0)).toBe(0xfeff);
      expect(lines[0].slice(1).split(',').slice(0, 3)).toEqual([
        'submission_uuid',
        'submitted_at',
        'event_type',
      ]);
      expect(lines).toHaveLength(5);
    });

    it('JSON và Excel; type deals, campaigns', async () => {
      const json = await api
        .http()
        .get('/api/v1/reports/export?format=json&type=deals&date_range=30d')
        .expect(200);
      expect(JSON.parse(json.text as string)).toHaveLength(2);
      const xlsx = await api
        .http()
        .get('/api/v1/reports/export?format=xlsx&type=campaigns&date_range=30d')
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(xlsx.headers['content-type']).toContain('spreadsheetml');
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    });

    it('CSV của deals, campaigns; khoảng không có dữ liệu chỉ có dòng tiêu đề', async () => {
      const deals = await api
        .http()
        .get('/api/v1/reports/export?type=deals&date_range=30d')
        .expect(200);
      expect(deals.text.split('\r\n').filter(Boolean)).toHaveLength(3);
      const campaigns = await api
        .http()
        .get('/api/v1/reports/export?type=campaigns&date_range=30d')
        .expect(200);
      expect(campaigns.text).toContain('Spring Sale 2024');
      const empty = await api
        .http()
        .get('/api/v1/reports/export?from=2020-01-01&to=2020-01-31')
        .expect(200);
      expect(empty.text.split('\r\n').filter(Boolean)).toHaveLength(1);
      await clearKeys(api, 'throttle:*');
    });

    it('gọi quá nhanh (E20): lần thứ 6 trong một phút 429 20016 kèm Retry-After', async () => {
      for (let i = 0; i < 5; i++)
        await api.http().get('/api/v1/reports/export?format=json').expect(200);
      const res = await api
        .http()
        .get('/api/v1/reports/export?format=json')
        .expect(429);
      expect(res.body.errorKbn).toBe(ErrorKbn.TOO_MANY_REQUESTS);
      expect(res.body.details).toEqual({
        retryAfterSeconds: expect.any(Number) as number,
      });
      expect(Number(res.headers['retry-after'])).toBe(
        res.body.details.retryAfterSeconds,
      );
    });
  });
});
