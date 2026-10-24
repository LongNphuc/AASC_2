import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { once } from 'node:events';
import type { DataSource } from 'typeorm';
import { DealStatusKbn } from '../../common/kbn/status.kbn';
import {
  DealOriginKbn,
  EVENT_TYPE_NAMES,
  kbnName,
  SourceKbn,
} from '../../common/kbn/type.kbn';
import { parseDateRange, type DateRange } from '../../common/query/date-range';
import { appConfig, type AppConfig } from '../../config/app-config';
import { SYNC_STATUS_NAMES } from '../../leads/mappers/lead-response.mapper';
import type { ExportQuery } from '../dto/export.query';
import { AnalyticsService } from './analytics.service';

type Row = Record<string, unknown>;

const UTF8_BOM = String.fromCharCode(0xfeff);

/** Mỗi lần đọc bao nhiêu dòng từ DB (đọc theo lô, ghi luồng ra response). */
const BATCH_SIZE = 500;

const SUBMISSION_COLUMNS = [
  'submission_uuid',
  'submitted_at',
  'event_type',
  'lead_uuid',
  'name',
  'email',
  'phone',
  'city',
  'channel',
  'campaign_id',
  'campaign_name',
  'ad_id',
  'ad_name',
  'form_id',
  'form_name',
  'quality_score',
  'sync_status',
  'bitrix_lead_id',
  'deal_uuid',
  'deal_stage',
  'deal_status',
  'deal_amount',
];
const DEAL_COLUMNS = [
  'deal_uuid',
  'created_at',
  'title',
  'lead_uuid',
  'name',
  'bitrix_deal_id',
  'pipeline_id',
  'stage',
  'status',
  'origin',
  'probability',
  'amount',
  'currency',
  'assigned_to',
  'campaign_id',
  'campaign_name',
  'closed_at',
];
const CAMPAIGN_COLUMNS = [
  'campaign_id',
  'campaign_name',
  'spend',
  'impressions',
  'clicks',
  'interactions',
  'submissions',
  'leads',
  'cpl',
  'cost_per_customer',
  'deals',
  'won',
  'lost',
  'lead_to_deal',
  'lead_to_won',
  'revenue',
  'cost_per_won',
  'roi',
  'avg_quality_score',
];

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Ghi từng dòng ra response theo một định dạng. */
interface RowWriter {
  begin(columns: string[]): Promise<void>;
  write(row: Row): Promise<void>;
  end(): Promise<void>;
}

/** Ghi và chờ "drain" khi bộ đệm của response đầy. */
async function writeChunk(res: Response, chunk: string): Promise<void> {
  if (!res.write(chunk)) await once(res, 'drain');
}

/** Ký tự đầu ô làm Excel hiểu là công thức (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value as string | number | boolean);
  // Chuỗi khách nhập (tên, câu trả lời) bắt đầu bằng = + - @ thì thêm ' để
  // Excel coi là chữ, không chạy công thức. Số (kể cả số âm) giữ nguyên.
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvWriter(res: Response): RowWriter {
  let columns: string[] = [];
  return {
    async begin(cols) {
      columns = cols;
      // BOM UTF-8 để Excel mở đúng tiếng Việt.
      await writeChunk(res, `${UTF8_BOM}${cols.join(',')}\r\n`);
    },
    write: (row) =>
      writeChunk(res, `${columns.map((c) => csvCell(row[c])).join(',')}\r\n`),
    end: () => {
      res.end();
      return Promise.resolve();
    },
  };
}

function jsonWriter(res: Response): RowWriter {
  let first = true;
  return {
    begin: () => writeChunk(res, '['),
    async write(row) {
      await writeChunk(res, `${first ? '' : ','}\n${JSON.stringify(row)}`);
      first = false;
    },
    end: () => {
      res.end(first ? ']' : '\n]');
      return Promise.resolve();
    },
  };
}

function xlsxWriter(res: Response, sheetName: string): RowWriter {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: false,
    useSharedStrings: false,
  });
  const sheet = workbook.addWorksheet(sheetName);
  return {
    begin(columns) {
      sheet.columns = columns.map((c) => ({ header: c, key: c, width: 18 }));
      return Promise.resolve();
    },
    write(row) {
      sheet.addRow(row).commit();
      return Promise.resolve();
    },
    async end() {
      sheet.commit();
      await workbook.commit();
    },
  };
}

/**
 * Export CSV / JSON / Excel (readme_design.md mục 9.6): đọc DB theo lô và ghi
 * luồng từng dòng ra response, không dựng cả tệp trong bộ nhớ. Excel dùng
 * exceljs ở chế độ ghi luồng; CSV có BOM UTF-8.
 */
@Injectable()
export class ExportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly analytics: AnalyticsService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async stream(query: ExportQuery, res: Response): Promise<void> {
    const format = query.format ?? 'csv';
    const type = query.type ?? 'submissions';
    const range = parseDateRange(query, this.config.timezone);
    res.setHeader('Content-Type', CONTENT_TYPES[format]);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${type}-${range.fromDate}_${range.toDate}.${format}"`,
    );
    const writer =
      format === 'csv'
        ? csvWriter(res)
        : format === 'json'
          ? jsonWriter(res)
          : xlsxWriter(res, type);

    if (type === 'campaigns') {
      await writer.begin(CAMPAIGN_COLUMNS);
      for (const item of await this.analytics.campaignItems(range)) {
        await writer.write(snakeKeys(item));
      }
    } else if (type === 'deals') {
      await writer.begin(DEAL_COLUMNS);
      for await (const row of this.dealRows(range)) await writer.write(row);
    } else {
      await writer.begin(SUBMISSION_COLUMNS);
      for await (const row of this.submissionRows(range))
        await writer.write(row);
    }
    await writer.end();
  }

  /** Mỗi dòng một lượt gửi, kèm Lead ID Bitrix24 và deal (nếu có); đọc theo khóa (submitted_at, uuid). */
  private async *submissionRows(range: DateRange): AsyncGenerator<Row> {
    let cursor: { at: Date; uuid: string } | null = null;
    for (;;) {
      const rows: Row[] = await this.dataSource.query(
        `SELECT s.uuid, s.submitted_at, s.event_type_kbn, s.lead_uuid, s.name, s.email, s.phone, s.city,
                s.channel_kbn, s.campaign_id, s.campaign_name, s.ad_id, s.ad_name, s.form_id, s.form_name,
                s.quality_score, s.sync_status_kbn, l.bitrix24_id, d.uuid AS deal_uuid, d.stage AS deal_stage,
                d.status_kbn AS deal_status_kbn, d.amount AS deal_amount
           FROM lead_submissions s
           JOIN leads l ON l.uuid = s.lead_uuid
           LEFT JOIN deals d ON d.uuid = s.deal_uuid
          WHERE s.submitted_at >= $1 AND s.submitted_at < $2
            AND ($3::timestamptz IS NULL OR (s.submitted_at, s.uuid) > ($3::timestamptz, $4::uuid))
          ORDER BY s.submitted_at, s.uuid
          LIMIT ${BATCH_SIZE}`,
        [range.from, range.to, cursor?.at ?? null, cursor?.uuid ?? null],
      );
      for (const r of rows) {
        yield {
          submission_uuid: r.uuid,
          submitted_at: r.submitted_at,
          event_type:
            EVENT_TYPE_NAMES[
              r.event_type_kbn as keyof typeof EVENT_TYPE_NAMES
            ] ?? null,
          lead_uuid: r.lead_uuid,
          name: r.name,
          email: r.email,
          phone: r.phone,
          city: r.city,
          channel: kbnName(SourceKbn, r.channel_kbn as number),
          campaign_id: r.campaign_id,
          campaign_name: r.campaign_name,
          ad_id: r.ad_id,
          ad_name: r.ad_name,
          form_id: r.form_id,
          form_name: r.form_name,
          quality_score: r.quality_score,
          sync_status: SYNC_STATUS_NAMES[r.sync_status_kbn as number] ?? null,
          bitrix_lead_id: r.bitrix24_id,
          deal_uuid: r.deal_uuid,
          deal_stage: r.deal_stage,
          deal_status: kbnName(
            DealStatusKbn,
            r.deal_status_kbn as number | null,
          ),
          deal_amount: r.deal_amount === null ? null : Number(r.deal_amount),
        };
      }
      if (rows.length < BATCH_SIZE) return;
      const last = rows[rows.length - 1];
      cursor = { at: last.submitted_at as Date, uuid: last.uuid as string };
    }
  }

  /** Mỗi dòng một deal, kèm khách và campaign của lượt gửi tạo ra deal. */
  private async *dealRows(range: DateRange): AsyncGenerator<Row> {
    let cursor: { at: Date; uuid: string } | null = null;
    for (;;) {
      const rows: Row[] = await this.dataSource.query(
        `SELECT d.*, l.name, s.campaign_id, s.campaign_name
           FROM deals d
           JOIN leads l ON l.uuid = d.lead_uuid
           JOIN lead_submissions s ON s.uuid = d.lead_submission_uuid
          WHERE d.created_at >= $1 AND d.created_at < $2
            AND ($3::timestamptz IS NULL OR (d.created_at, d.uuid) > ($3::timestamptz, $4::uuid))
          ORDER BY d.created_at, d.uuid
          LIMIT ${BATCH_SIZE}`,
        [range.from, range.to, cursor?.at ?? null, cursor?.uuid ?? null],
      );
      for (const r of rows) {
        yield {
          deal_uuid: r.uuid,
          created_at: r.created_at,
          title: r.title,
          lead_uuid: r.lead_uuid,
          name: r.name,
          bitrix_deal_id: r.bitrix24_id,
          pipeline_id: r.pipeline_id,
          stage: r.stage,
          status: kbnName(DealStatusKbn, r.status_kbn as number),
          origin: kbnName(DealOriginKbn, r.origin_kbn as number),
          probability: r.probability,
          amount: r.amount === null ? null : Number(r.amount),
          currency: r.currency,
          assigned_to: r.assigned_to,
          campaign_id: r.campaign_id,
          campaign_name: r.campaign_name,
          closed_at: r.closed_at,
        };
      }
      if (rows.length < BATCH_SIZE) return;
      const last = rows[rows.length - 1];
      cursor = { at: last.created_at as Date, uuid: last.uuid as string };
    }
  }
}

/** campaignId → campaign_id cho cột export. */
function snakeKeys(item: Record<string, unknown>): Row {
  return Object.fromEntries(
    Object.entries(item).map(([key, value]) => [
      key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
      value,
    ]),
  );
}
