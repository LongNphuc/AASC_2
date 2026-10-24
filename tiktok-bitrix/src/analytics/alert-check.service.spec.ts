import type { DataSource } from 'typeorm';
import { AlertTypeKbn } from '../common/kbn/type.kbn';
import type { AppConfig } from '../config/app-config';
import type { ConfigurationService } from '../configurations/services/configuration.service';
import type {
  GroupRow,
  MetricsRepository,
} from './repositories/metrics.repository';
import { AlertCheckService } from './services/alert-check.service';
import type { AlertService } from './services/alert.service';
import type { AnalyticsService } from './services/analytics.service';
import { emptyCounts } from './services/metrics.calculator';

const rules = { cpl_max: 80_000, conversion_drop_percent: 30, min_leads: 20 };

function row(key: string, leads: number, deals: number): GroupRow {
  return {
    key,
    name: `Campaign ${key}`,
    counts: { ...emptyCounts(), leads, deals },
    impressions: null,
    clicks: null,
  };
}

/** AlertCheckService với số liệu giả: campaign hôm nay, 7 ngày này, 7 ngày trước, số sự kiện hết vòng. */
function setup(data: {
  campaigns?: {
    campaignId: string | null;
    campaignName: string | null;
    cpl: number | null;
  }[];
  current?: GroupRow[];
  previous?: GroupRow[];
  exhausted?: number;
}) {
  const raised: { type: AlertTypeKbn; subject: string }[] = [];
  const alerts = {
    raise: (type: AlertTypeKbn, subject: string) => {
      raised.push({ type, subject });
      // Cảnh báo trùng trong cửa sổ chống trùng thì raise trả null.
      return Promise.resolve(subject === 'campaign:dup' ? null : {});
    },
  } as unknown as AlertService;
  let grouped = 0;
  const service = new AlertCheckService(
    alerts,
    {
      campaignItems: () => Promise.resolve(data.campaigns ?? []),
    } as unknown as AnalyticsService,
    {
      grouped: () =>
        Promise.resolve(
          grouped++ === 0 ? (data.current ?? []) : (data.previous ?? []),
        ),
    } as unknown as MetricsRepository,
    {
      get: () => Promise.resolve({ value: rules }),
    } as unknown as ConfigurationService,
    {
      query: () => Promise.resolve([{ count: data.exhausted ?? 0 }]),
    } as unknown as DataSource,
    {
      timezone: 'Asia/Ho_Chi_Minh',
      queue: { recoveryMaxRounds: 3 },
    } as AppConfig,
  );
  return { service, raised };
}

describe('AlertCheckService', () => {
  it('CPL hôm nay vượt ngưỡng: CPL_HIGH; không có chi phí (cpl null) thì bỏ qua', async () => {
    const { service, raised } = setup({
      campaigns: [
        { campaignId: '1', campaignName: 'A', cpl: 90_000 },
        { campaignId: '2', campaignName: null, cpl: 50_000 },
        { campaignId: null, campaignName: null, cpl: null },
        { campaignId: 'dup', campaignName: null, cpl: 100_000 },
      ],
    });
    expect(await service.check()).toBe(1);
    expect(raised).toEqual([
      { type: AlertTypeKbn.CPL_HIGH, subject: 'campaign:1' },
      { type: AlertTypeKbn.CPL_HIGH, subject: 'campaign:dup' },
    ]);
  });

  it('tỉ lệ lead → deal 7 ngày giảm quá ngưỡng: CONVERSION_DROP; ít khách hoặc không có kỳ trước thì bỏ qua', async () => {
    const { service, raised } = setup({
      current: [
        row('1', 40, 4),
        row('2', 40, 10),
        row('3', 5, 0),
        row('4', 40, 4),
        row('5', 40, 2),
      ],
      previous: [
        row('1', 40, 10),
        row('2', 40, 10),
        row('3', 40, 10),
        row('5', 40, 0),
      ],
    });
    expect(await service.check()).toBe(1);
    expect(raised).toEqual([
      { type: AlertTypeKbn.CONVERSION_DROP, subject: 'campaign:1' },
    ]);
  });

  it('sự kiện hết vòng chạy lại: DLQ_NOT_EMPTY', async () => {
    const { service, raised } = setup({ exhausted: 2 });
    expect(await service.check(new Date('2026-10-24T00:00:00Z'))).toBe(1);
    expect(raised).toEqual([
      { type: AlertTypeKbn.DLQ_NOT_EMPTY, subject: 'crm-pipeline' },
    ]);
  });
});
