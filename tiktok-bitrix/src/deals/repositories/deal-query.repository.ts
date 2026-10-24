import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { In, type DataSource } from 'typeorm';
import { DealOriginKbn, kbnFromName } from '../../common/kbn/type.kbn';
import { DealStatusKbn } from '../../common/kbn/status.kbn';
import { parseDateRange } from '../../common/query/date-range';
import { paginate, type Page } from '../../common/query/pagination.dto';
import { SqlParams } from '../../common/query/sql-builder';
import { appConfig, type AppConfig } from '../../config/app-config';
import { Lead } from '../../leads/entities/lead.entity';
import { LeadSubmission } from '../../leads/entities/lead-submission.entity';
import { toSubmissionItem } from '../../leads/mappers/lead-response.mapper';
import type { ListDealsQuery } from '../dto/list-deals.query';
import { Deal } from '../entities/deal.entity';
import { toDealItem } from '../mappers/deal-response.mapper';

export type DealItem = ReturnType<typeof toDealItem>;

/** Danh sách deal có lọc, phân trang; deal kèm khách, lượt gửi tạo ra nó, số lượt gắn thêm. */
@Injectable()
export class DealQueryRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async list(query: ListDealsQuery): Promise<Page<DealItem>> {
    const p = new SqlParams();
    p.where(
      query.status ? kbnFromName(DealStatusKbn, query.status) : undefined,
      (x) => `d.status_kbn = ${x}`,
    )
      .where(query.assigned_to, (x) => `d.assigned_to = ${x}`)
      .where(query.pipeline_id, (x) => `d.pipeline_id = ${x}`)
      .where(
        query.origin ? kbnFromName(DealOriginKbn, query.origin) : undefined,
        (x) => `d.origin_kbn = ${x}`,
      )
      .where(query.campaign_id, (x) => `s.campaign_id = ${x}`);
    if (query.date_range || query.from || query.to) {
      const range = parseDateRange(query, this.config.timezone);
      p.where(range.from, (x) => `d.created_at >= ${x}`).where(
        range.to,
        (x) => `d.created_at < ${x}`,
      );
    }
    const from = `FROM deals d JOIN lead_submissions s ON s.uuid = d.lead_submission_uuid ${p.clause}`;
    const [{ total }] = await this.dataSource.query<{ total: number }[]>(
      `SELECT count(*)::int AS total ${from}`,
      p.values,
    );
    const rows = await this.dataSource.query<{ uuid: string }[]>(
      `SELECT d.uuid ${from} ORDER BY d.created_at DESC
        LIMIT ${p.param(query.limit)} OFFSET ${p.param((query.page - 1) * query.limit)}`,
      p.values,
    );
    return paginate(await this.items(rows.map((r) => r.uuid)), total, query);
  }

  /** Deal của một khách (GET /api/v1/leads/:uuid). */
  async byLead(leadUuid: string): Promise<DealItem[]> {
    const deals = await this.dataSource.getRepository(Deal).find({
      where: { leadUuid },
      order: { createdAt: 'DESC' },
      select: { uuid: true },
    });
    return this.items(deals.map((d) => d.uuid));
  }

  /** Một deal kèm lượt gửi tạo ra nó và các lượt được gắn thêm. */
  async detail(uuid: string) {
    const [item] = await this.items([uuid]);
    if (!item) return null;
    const submissions = await this.dataSource
      .getRepository(LeadSubmission)
      .find({
        where: { dealUuid: uuid },
        order: { submittedAt: 'ASC' },
      });
    const deal = await this.dataSource
      .getRepository(Deal)
      .findOneByOrFail({ uuid });
    return {
      ...item,
      originSubmission:
        submissions
          .filter((s) => s.uuid === deal.leadSubmissionUuid)
          .map(toSubmissionItem)[0] ?? item.originSubmission,
      attachedSubmissions: submissions
        .filter((s) => s.uuid !== deal.leadSubmissionUuid)
        .map(toSubmissionItem),
    };
  }

  /** Dựng phần tử API cho danh sách uuid deal, giữ đúng thứ tự. */
  private async items(uuids: string[]): Promise<DealItem[]> {
    if (uuids.length === 0) return [];
    const deals = await this.dataSource
      .getRepository(Deal)
      .findBy({ uuid: In(uuids) });
    const leads = await this.dataSource
      .getRepository(Lead)
      .findBy({ uuid: In([...new Set(deals.map((d) => d.leadUuid))]) });
    const origins = await this.dataSource
      .getRepository(LeadSubmission)
      .findBy({ uuid: In(deals.map((d) => d.leadSubmissionUuid)) });
    const attached = await this.dataSource.query<
      { deal_uuid: string; count: number }[]
    >(
      `SELECT s.deal_uuid, count(*)::int AS count
         FROM lead_submissions s JOIN deals d ON d.uuid = s.deal_uuid
        WHERE s.deal_uuid = ANY($1::uuid[]) AND s.uuid <> d.lead_submission_uuid
        GROUP BY s.deal_uuid`,
      [uuids],
    );
    const byUuid = new Map(deals.map((d) => [d.uuid, d]));
    return uuids
      .map((uuid) => byUuid.get(uuid))
      .filter((d): d is Deal => !!d)
      .map((deal) =>
        toDealItem(
          deal,
          leads.find((l) => l.uuid === deal.leadUuid) ?? null,
          origins.find((s) => s.uuid === deal.leadSubmissionUuid) ?? null,
          attached.find((a) => a.deal_uuid === deal.uuid)?.count ?? 0,
        ),
      );
  }
}
