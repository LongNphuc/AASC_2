import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { DealStatusKbn } from '../../common/kbn/status.kbn';
import { EventTypeKbn, TIKTOK_EVENT_TYPES } from '../../common/kbn/type.kbn';
import type { DateRange } from '../../common/query/date-range';
import { SqlParams } from '../../common/query/sql-builder';
import { emptyCounts, type MetricCounts } from '../services/metrics.calculator';

export type GroupBy = 'campaign' | 'ad' | 'form' | 'event_type' | 'day';

export interface MetricsFilter {
  campaign_id?: string;
  ad_id?: string;
  form_id?: string;
  /** lead.generate, form.complete, user.interaction. */
  event_type?: string;
}

export interface GroupRow {
  /** Giá trị nhóm (campaign_id, ngày, mã loại sự kiện…); '' khi lượt gửi không có giá trị đó. */
  key: string;
  name: string | null;
  counts: MetricCounts;
  impressions: number | null;
  clicks: number | null;
}

/** Biểu thức nhóm trên từng bảng; null = bảng đó không gom được theo nhóm này. */
interface GroupExpr {
  submission: string;
  name: string | null;
  engagement: string | null;
  spend: string | null;
}

/**
 * Truy vấn SQL gom theo campaign, ad, form, loại sự kiện, ngày (readme_design.md
 * mục 9.1–9.3). Lọc theo khoảng submitted_at rồi gom, dùng các index ghép
 * (nguồn, submitted_at). Deal tính vào lượt gửi đã TẠO ra nó (cohort theo thời
 * điểm gửi form), không tính công cho lượt gửi gắn thêm.
 */
@Injectable()
export class MetricsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async grouped(
    groupBy: GroupBy,
    range: DateRange,
    filter: MetricsFilter,
  ): Promise<GroupRow[]> {
    const expr = groupExpr(groupBy);
    const rows = new Map<string, GroupRow>();
    const row = (key: string | null): GroupRow => {
      const k = key ?? '';
      let existing = rows.get(k);
      if (!existing) {
        existing = {
          key: k,
          name: null,
          // Chỉ có chi phí khi nhóm có dòng campaign_spend (readme_api.md mục 7).
          counts: emptyCounts(),
          impressions: null,
          clicks: null,
        };
        rows.set(k, existing);
      }
      return existing;
    };

    for (const r of await this.submissionCounts(range, filter, expr)) {
      const target = row(r.key);
      target.name = target.name ?? r.name;
      Object.assign(target.counts, toCounts(r));
    }
    if (expr.engagement) {
      for (const r of await this.interactionCounts(
        range,
        filter,
        expr.engagement,
      )) {
        row(r.key).counts.interactions = r.interactions;
      }
    }
    if (expr.spend && spendApplies(filter)) {
      for (const r of await this.spendRows(range, filter, expr.spend)) {
        const target = row(r.key);
        target.counts.spend = Number(r.spend);
        target.impressions =
          r.impressions === null ? null : Number(r.impressions);
        target.clicks = r.clicks === null ? null : Number(r.clicks);
        target.name = target.name ?? r.name;
      }
    }
    return [...rows.values()];
  }

  /** Tổng của cả khoảng (khách đếm DISTINCT trên mọi lượt gửi, không cộng các dòng). */
  async totals(range: DateRange, filter: MetricsFilter): Promise<MetricCounts> {
    const expr: GroupExpr = {
      submission: `''`,
      name: null,
      engagement: `''`,
      spend: `''`,
    };
    const counts = emptyCounts();
    const [submissions] = await this.submissionCounts(range, filter, expr);
    if (submissions) Object.assign(counts, toCounts(submissions));
    const [interactions] = await this.interactionCounts(range, filter, `''`);
    counts.interactions = interactions?.interactions ?? 0;
    if (spendApplies(filter)) {
      const [spend] = await this.spendRows(range, filter, `''`);
      counts.spend = spend ? Number(spend.spend) : null;
    }
    return counts;
  }

  private async submissionCounts(
    range: DateRange,
    filter: MetricsFilter,
    expr: GroupExpr,
  ) {
    if (filter.event_type === 'user.interaction') return [];
    const p = new SqlParams();
    const key = withTimezone(expr.submission, p, range.timezone);
    p.where(range.from, (x) => `s.submitted_at >= ${x}`)
      .where(range.to, (x) => `s.submitted_at < ${x}`)
      .where(filter.campaign_id, (x) => `s.campaign_id = ${x}`)
      .where(filter.ad_id, (x) => `s.ad_id = ${x}`)
      .where(filter.form_id, (x) => `s.form_id = ${x}`)
      .where(
        filter.event_type ? TIKTOK_EVENT_TYPES[filter.event_type] : undefined,
        (x) => `s.event_type_kbn = ${x}`,
      );
    const won = p.param(DealStatusKbn.WON);
    const lost = p.param(DealStatusKbn.LOST);
    return this.dataSource.query<SubmissionRow[]>(
      `SELECT ${key} AS key,
              ${expr.name ? `max(${expr.name})` : 'NULL'} AS name,
              count(*)::int AS submissions,
              count(DISTINCT s.lead_uuid)::int AS leads,
              count(d.uuid)::int AS deals,
              count(d.uuid) FILTER (WHERE d.status_kbn = ${won})::int AS won,
              count(d.uuid) FILTER (WHERE d.status_kbn = ${lost})::int AS lost,
              COALESCE(sum(d.amount) FILTER (WHERE d.status_kbn = ${won}), 0) AS revenue,
              avg(d.amount) FILTER (WHERE d.status_kbn = ${won}) AS avg_deal_value,
              avg(s.quality_score) AS avg_quality_score,
              count(s.completed_at)::int AS completed
         FROM lead_submissions s
         LEFT JOIN deals d ON d.lead_submission_uuid = s.uuid
         ${p.clause}
        GROUP BY 1`,
      p.values,
    );
  }

  private async interactionCounts(
    range: DateRange,
    filter: MetricsFilter,
    keyExpr: string,
  ) {
    if (filter.event_type && filter.event_type !== 'user.interaction')
      return [];
    const p = new SqlParams();
    const key = withTimezone(keyExpr, p, range.timezone);
    p.where(range.from, (x) => `e.occurred_at >= ${x}`)
      .where(range.to, (x) => `e.occurred_at < ${x}`)
      .where(filter.campaign_id, (x) => `e.campaign_id = ${x}`)
      .where(filter.ad_id, (x) => `e.ad_id = ${x}`)
      .where(filter.form_id, (x) => `e.form_id = ${x}`);
    return this.dataSource.query<
      { key: string | null; interactions: number }[]
    >(
      `SELECT ${key} AS key, count(*)::int AS interactions
         FROM engagement_events e ${p.clause} GROUP BY 1`,
      p.values,
    );
  }

  private async spendRows(
    range: DateRange,
    filter: MetricsFilter,
    keyExpr: string,
  ) {
    const p = new SqlParams();
    p.where(range.fromDate, (x) => `c.spend_date >= ${x}::date`)
      .where(range.toDate, (x) => `c.spend_date <= ${x}::date`)
      .where(filter.campaign_id, (x) => `c.campaign_id = ${x}`);
    return this.dataSource.query<
      {
        key: string | null;
        name: string | null;
        spend: string;
        impressions: string | null;
        clicks: string | null;
      }[]
    >(
      `SELECT ${keyExpr} AS key, max(c.campaign_name) AS name, sum(c.spend) AS spend,
              sum(c.impressions) AS impressions, sum(c.clicks) AS clicks
         FROM campaign_spend c ${p.clause} GROUP BY 1`,
      p.values,
    );
  }
}

interface SubmissionRow {
  key: string | null;
  name: string | null;
  submissions: number;
  leads: number;
  deals: number;
  won: number;
  lost: number;
  revenue: string;
  avg_deal_value: string | null;
  avg_quality_score: string | null;
  completed: number;
}

/** Thay $TZ bằng tham số múi giờ, chỉ khi biểu thức cần (tham số thừa làm PostgreSQL báo lỗi kiểu). */
function withTimezone(expr: string, p: SqlParams, timezone: string): string {
  return expr.includes('$TZ') ? expr.replace('$TZ', p.param(timezone)) : expr;
}

function toCounts(r: SubmissionRow): Partial<MetricCounts> {
  return {
    submissions: r.submissions,
    leads: r.leads,
    deals: r.deals,
    won: r.won,
    lost: r.lost,
    revenue: Number(r.revenue),
    avgDealValue: r.avg_deal_value === null ? null : Number(r.avg_deal_value),
    avgQualityScore:
      r.avg_quality_score === null ? null : Number(r.avg_quality_score),
    completed: r.completed,
  };
}

/** Chi phí lưu theo campaign và ngày: lọc theo ad, form, loại sự kiện thì không có chi phí (mục 9.3). */
function spendApplies(filter: MetricsFilter): boolean {
  return !filter.ad_id && !filter.form_id && !filter.event_type;
}

function groupExpr(groupBy: GroupBy): GroupExpr {
  switch (groupBy) {
    case 'ad':
      return {
        submission: `COALESCE(s.ad_id, '')`,
        name: 's.ad_name',
        engagement: `COALESCE(e.ad_id, '')`,
        spend: null,
      };
    case 'form':
      return {
        submission: `COALESCE(s.form_id, '')`,
        name: 's.form_name',
        engagement: `COALESCE(e.form_id, '')`,
        spend: null,
      };
    case 'event_type':
      return {
        submission: 's.event_type_kbn::text',
        name: null,
        engagement: `'${EventTypeKbn.USER_INTERACTION}'`,
        spend: null,
      };
    case 'day':
      return {
        submission: `to_char(s.submitted_at AT TIME ZONE $TZ, 'YYYY-MM-DD')`,
        name: null,
        engagement: `to_char(e.occurred_at AT TIME ZONE $TZ, 'YYYY-MM-DD')`,
        spend: `to_char(c.spend_date, 'YYYY-MM-DD')`,
      };
    default:
      return {
        submission: `COALESCE(s.campaign_id, '')`,
        name: 's.campaign_name',
        engagement: `COALESCE(e.campaign_id, '')`,
        spend: `c.campaign_id`,
      };
  }
}
