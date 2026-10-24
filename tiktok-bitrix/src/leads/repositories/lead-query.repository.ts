import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { In, type DataSource } from 'typeorm';
import { DealStatusKbn, LeadStatusKbn } from '../../common/kbn/status.kbn';
import { CHANNEL_NAMES, kbnFromName } from '../../common/kbn/type.kbn';
import { parseDateRange } from '../../common/query/date-range';
import { paginate, type Page } from '../../common/query/pagination.dto';
import { SqlParams } from '../../common/query/sql-builder';
import { appConfig, type AppConfig } from '../../config/app-config';
import { DealQueryRepository } from '../../deals/repositories/deal-query.repository';
import type { ListLeadsQuery } from '../dto/list-leads.query';
import { Lead } from '../entities/lead.entity';
import { LeadSubmission } from '../entities/lead-submission.entity';
import {
  SYNC_STATUS_BY_NAME,
  toLeadItem,
  toSubmissionItem,
  type LeadSummary,
} from '../mappers/lead-response.mapper';
import { normalizePhone } from '../transformers/phone.transformer';

export type LeadItem = ReturnType<typeof toLeadItem>;

/** Danh sách khách có lọc, phân trang, kèm số lượt gửi, nguồn, deal (readme_api.md mục 4). */
@Injectable()
export class LeadQueryRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly deals: DealQueryRepository,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async list(query: ListLeadsQuery): Promise<Page<LeadItem>> {
    const p = new SqlParams();
    p.where(
      query.status ? kbnFromName(LeadStatusKbn, query.status) : undefined,
      (x) => `l.status_kbn = ${x}`,
    );
    if (query.q) {
      const like = p.param(`%${query.q}%`);
      const phone = normalizePhone(query.q, this.config.lead.phoneRegion);
      p.raw(
        `(l.name ILIKE ${like} OR l.email ILIKE ${like} OR l.phone ILIKE ${like}` +
          (phone ? ` OR l.phone = ${p.param(phone)})` : ')'),
      );
    }
    if (query.date_range || query.from || query.to) {
      const range = parseDateRange(query, this.config.timezone);
      p.where(range.from, (x) => `l.last_submitted_at >= ${x}`).where(
        range.to,
        (x) => `l.last_submitted_at < ${x}`,
      );
    }
    // Khách có ít nhất một lượt gửi thỏa các điều kiện theo nguồn.
    const sub: string[] = [];
    if (query.source)
      sub.push(`s.channel_kbn = ${p.param(CHANNEL_NAMES[query.source])}`);
    if (query.campaign_id)
      sub.push(`s.campaign_id = ${p.param(query.campaign_id)}`);
    if (query.ad_id) sub.push(`s.ad_id = ${p.param(query.ad_id)}`);
    if (query.form_id) sub.push(`s.form_id = ${p.param(query.form_id)}`);
    if (query.sync_status)
      sub.push(
        `s.sync_status_kbn = ${p.param(SYNC_STATUS_BY_NAME[query.sync_status])}`,
      );
    if (sub.length) {
      p.raw(
        `EXISTS (SELECT 1 FROM lead_submissions s WHERE s.lead_uuid = l.uuid AND ${sub.join(' AND ')})`,
      );
    }

    const [{ total }] = await this.dataSource.query<{ total: number }[]>(
      `SELECT count(*)::int AS total FROM leads l ${p.clause}`,
      p.values,
    );
    const rows = await this.dataSource.query<{ uuid: string }[]>(
      `SELECT l.uuid FROM leads l ${p.clause}
        ORDER BY l.last_submitted_at DESC, l.uuid
        LIMIT ${p.param(query.limit)} OFFSET ${p.param((query.page - 1) * query.limit)}`,
      p.values,
    );
    const uuids = rows.map((r) => r.uuid);
    const leads = await this.dataSource
      .getRepository(Lead)
      .findBy({ uuid: In(uuids) });
    const summaries = await this.summaries(uuids);
    const items = uuids
      .map((uuid) => leads.find((l) => l.uuid === uuid))
      .filter((l): l is Lead => !!l)
      .map((lead) => toLeadItem(lead, summaries.get(lead.uuid)!));
    return paginate(items, total, query);
  }

  /** Một khách kèm mọi lượt gửi và deal. */
  async detail(uuid: string) {
    const lead = await this.dataSource.getRepository(Lead).findOneBy({ uuid });
    if (!lead) return null;
    const summaries = await this.summaries([uuid]);
    const submissions = await this.dataSource
      .getRepository(LeadSubmission)
      .find({
        where: { leadUuid: uuid },
        order: { submittedAt: 'DESC' },
      });
    return {
      ...toLeadItem(lead, summaries.get(uuid)!),
      submissions: submissions.map(toSubmissionItem),
      deals: await this.deals.byLead(uuid),
    };
  }

  private async summaries(uuids: string[]): Promise<Map<string, LeadSummary>> {
    const result = new Map<string, LeadSummary>(
      uuids.map((uuid) => [
        uuid,
        { submissionCount: 0, channels: [], latest: null, openDealCount: 0 },
      ]),
    );
    if (uuids.length === 0) return result;
    const channels = await this.dataSource.query<
      { lead_uuid: string; channel_kbn: number; count: number }[]
    >(
      `SELECT lead_uuid, channel_kbn, count(*)::int AS count
         FROM lead_submissions WHERE lead_uuid = ANY($1::uuid[])
        GROUP BY lead_uuid, channel_kbn ORDER BY lead_uuid, min(submitted_at)`,
      [uuids],
    );
    for (const row of channels) {
      const summary = result.get(row.lead_uuid)!;
      summary.channels.push(row.channel_kbn);
      summary.submissionCount += row.count;
    }
    const latest = await this.dataSource
      .getRepository(LeadSubmission)
      .createQueryBuilder('s')
      .distinctOn(['s.lead_uuid'])
      .where('s.lead_uuid IN (:...uuids)', { uuids })
      .orderBy('s.lead_uuid')
      .addOrderBy('s.submitted_at', 'DESC')
      .getMany();
    for (const submission of latest)
      result.get(submission.leadUuid)!.latest = submission;
    const open = await this.dataSource.query<
      { lead_uuid: string; count: number }[]
    >(
      `SELECT lead_uuid, count(*)::int AS count FROM deals
        WHERE lead_uuid = ANY($1::uuid[]) AND status_kbn = $2 GROUP BY lead_uuid`,
      [uuids, DealStatusKbn.OPEN],
    );
    for (const row of open)
      result.get(row.lead_uuid)!.openDealCount = row.count;
    return result;
  }
}
