import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { createHash } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { StatusKbn, WebhookStatusKbn } from '../../common/kbn/status.kbn';
import { EVENT_TYPE_NAMES } from '../../common/kbn/type.kbn';
import {
  addDays,
  localDate,
  parseDateRange,
  type DateRange,
} from '../../common/query/date-range';
import { REDIS } from '../../common/redis/redis.module';
import { appConfig, type AppConfig } from '../../config/app-config';
import type {
  CampaignPerformanceQuery,
  ConversionRatesQuery,
} from '../dto/analytics.query';
import {
  MetricsRepository,
  type GroupBy,
  type GroupRow,
} from '../repositories/metrics.repository';
import { deriveMetrics } from './metrics.calculator';

/** Cache của dashboard: ngắn để vẫn gần thời gian thực (readme_design.md mục 9.5). */
const OVERVIEW_TTL_SECONDS = 15;

function rangeJson(range: DateRange) {
  return { from: range.fromDate, to: range.toDate, timezone: range.timezone };
}

/** Khóa của một nhóm trong phản hồi API. */
function groupKey(
  groupBy: GroupBy,
  row: GroupRow,
): Record<string, string | null> {
  const value = row.key || null;
  switch (groupBy) {
    case 'ad':
      return { adId: value, adName: row.name };
    case 'form':
      return { formId: value, formName: row.name };
    case 'event_type':
      return {
        eventType: value ? (EVENT_TYPE_NAMES[Number(value)] ?? value) : null,
      };
    case 'day':
      return { day: value };
    default:
      return { campaignId: value, campaignName: row.name };
  }
}

/**
 * Chỉ số thống kê (readme_design.md mục 9): chỉ đọc PostgreSQL, không gọi
 * Bitrix24 hay TikTok; cache Redis theo khóa là hash của tham số.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly metrics: MetricsRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  conversionRates(query: ConversionRatesQuery) {
    return this.cached(
      'conversion-rates',
      query,
      this.config.cache.analyticsSeconds,
      async () => {
        const groupBy = query.group_by ?? 'campaign';
        const range = parseDateRange(query, this.config.timezone);
        const rows = await this.metrics.grouped(groupBy, range, query);
        const totals = deriveMetrics(await this.metrics.totals(range, query));
        return {
          range: rangeJson(range),
          groupBy,
          items: rows
            .map((row) => ({
              key: groupKey(groupBy, row),
              ...deriveMetrics(row.counts),
            }))
            .sort(
              (a, b) =>
                b.submissions - a.submissions ||
                b.interactions - a.interactions,
            ),
          totals: {
            interactions: totals.interactions,
            submissions: totals.submissions,
            leads: totals.leads,
            deals: totals.deals,
            won: totals.won,
            lost: totals.lost,
            leadToDeal: totals.leadToDeal,
            leadToWon: totals.leadToWon,
            revenue: totals.revenue,
          },
        };
      },
    );
  }

  campaignPerformance(query: CampaignPerformanceQuery) {
    return this.cached(
      'campaign-performance',
      query,
      this.config.cache.analyticsSeconds,
      async () => {
        const range = parseDateRange(query, this.config.timezone);
        return {
          range: rangeJson(range),
          items: await this.campaignItems(range, query.campaign_id),
        };
      },
    );
  }

  /** Chỉ số theo campaign, dùng cho API, export và báo cáo ngày. */
  async campaignItems(range: DateRange, campaignId?: string) {
    const rows = await this.metrics.grouped('campaign', range, {
      campaign_id: campaignId,
    });
    return rows
      .map((row) => {
        const m = deriveMetrics(row.counts);
        return {
          campaignId: row.key || null,
          campaignName: row.name,
          spend: m.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          interactions: m.interactions,
          submissions: m.submissions,
          leads: m.leads,
          cpl: m.cpl,
          costPerCustomer: m.costPerCustomer,
          deals: m.deals,
          won: m.won,
          lost: m.lost,
          leadToDeal: m.leadToDeal,
          leadToWon: m.leadToWon,
          revenue: m.revenue,
          costPerWon: m.costPerWon,
          roi: m.roi,
          avgQualityScore: m.avgQualityScore,
        };
      })
      .sort(
        (a, b) =>
          (b.spend ?? 0) - (a.spend ?? 0) || b.submissions - a.submissions,
      );
  }

  /** Dashboard: hôm nay, 7 ngày, top campaign, tình trạng đồng bộ, job lỗi, cảnh báo. */
  overview() {
    return this.cached('overview', {}, OVERVIEW_TTL_SECONDS, async () => {
      const tz = this.config.timezone;
      const today = localDate(new Date(), tz);
      const todayRange = parseDateRange({ from: today, to: today }, tz);
      const weekRange = parseDateRange(
        { from: addDays(today, -6), to: today },
        tz,
      );
      const [
        todayTotals,
        weekTotals,
        newToday,
        newWeek,
        campaigns,
        sync,
        deadLetters,
        alerts,
      ] = await Promise.all([
        this.metrics.totals(todayRange, {}),
        this.metrics.totals(weekRange, {}),
        this.newLeads(todayRange),
        this.newLeads(weekRange),
        this.metrics.grouped('campaign', weekRange, {}),
        this.dataSource.query<{ pending: number; failed: number }[]>(
          `SELECT count(*) FILTER (WHERE sync_status_kbn = $1)::int AS pending,
                    count(*) FILTER (WHERE sync_status_kbn = $2)::int AS failed
               FROM lead_submissions`,
          [StatusKbn.PENDING, StatusKbn.FAILED],
        ),
        this.dataSource.query<{ count: number }[]>(
          `SELECT count(*)::int AS count FROM webhook_events WHERE status_kbn = $1`,
          [WebhookStatusKbn.FAILED],
        ),
        this.dataSource.query<
          {
            uuid: string;
            type_kbn: number;
            message: string;
            created_at: Date;
          }[]
        >(
          `SELECT uuid, type_kbn, message, created_at FROM alerts
              WHERE created_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 5`,
        ),
      ]);
      const summary = (counts: typeof todayTotals, newLeads: number) => {
        const m = deriveMetrics(counts);
        return {
          submissions: m.submissions,
          newLeads,
          deals: m.deals,
          won: m.won,
          revenue: m.revenue,
          leadToDeal: m.leadToDeal,
        };
      };
      return {
        today: summary(todayTotals, newToday),
        last7Days: summary(weekTotals, newWeek),
        topCampaigns: campaigns
          .sort((a, b) => b.counts.leads - a.counts.leads)
          .slice(0, 5)
          .map((row) => ({
            campaignId: row.key || null,
            campaignName: row.name,
            leads: row.counts.leads,
            submissions: row.counts.submissions,
            deals: row.counts.deals,
            won: row.counts.won,
          })),
        sync: sync[0],
        deadLetters: deadLetters[0].count,
        alerts: alerts.map((a) => ({
          uuid: a.uuid,
          typeKbn: a.type_kbn,
          message: a.message,
          createdAt: a.created_at,
        })),
      };
    });
  }

  private async newLeads(range: DateRange): Promise<number> {
    const [row] = await this.dataSource.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM leads WHERE first_submitted_at >= $1 AND first_submitted_at < $2`,
      [range.from, range.to],
    );
    return row.count;
  }

  /** Cache Redis analytics:{endpoint}:{hash tham số}; kết quả kèm cachedAt. */
  private async cached<T extends object>(
    endpoint: string,
    params: object,
    ttlSeconds: number,
    compute: () => Promise<T>,
  ): Promise<T & { cachedAt: string }> {
    const hash = createHash('sha1')
      .update(JSON.stringify(params))
      .digest('hex')
      .slice(0, 16);
    const key = `analytics:${endpoint}:${hash}`;
    const hit = await this.redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as T & { cachedAt: string };
    const value = { ...(await compute()), cachedAt: new Date().toISOString() };
    await this.redis
      .set(key, JSON.stringify(value), 'EX', ttlSeconds)
      .catch(() => undefined);
    return value;
  }
}
