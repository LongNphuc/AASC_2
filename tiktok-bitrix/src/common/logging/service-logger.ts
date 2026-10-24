import { Logger } from '@nestjs/common';
import { describeErrorKbn } from '../kbn/error.kbn';
import { logFiles } from './log-files';
import { logContext } from './request-context';

/** Các service có tệp log riêng trong logs/services/ (readme_design.md mục 15). */
export enum LogService {
  /** Request webhook TikTok, Bitrix24: chữ ký, trùng, lưu, đẩy job. */
  WEBHOOK = 'service_webhook',
  /** Module 1: chuẩn hóa, validate, tìm trùng, gộp. */
  LEAD = 'service_lead',
  /** Từng lệnh gọi Bitrix24. */
  BITRIX = 'service_bitrix',
  /** Rule khớp, deal tạo, gắn, đổi stage. */
  DEAL = 'service_deal',
  /** Từng lệnh gọi TikTok Events API. */
  TIKTOK = 'service_tiktok',
  /** Job: bắt đầu, từng bước, xong, lỗi, thử lại, recovery. */
  JOB = 'service_job',
  /** Request vào /api/v1/*. */
  API = 'service_api',
  /** Module 3: thống kê, báo cáo, cảnh báo về số liệu (CONVERSION_DROP). */
  ANALYTICS = 'service_analytics',
}

export type LogLevelName = 'INFO' | 'WARN' | 'ERROR';

/** Một dòng trong services/<service>.log. */
export interface ServiceLogEntry {
  level?: LogLevelName;
  /** Việc vừa làm, ví dụ "POST /api/v1/leads 200" hoặc "crm.lead.add". */
  action: string;
  /** Kết quả ngắn: SUCCESS, FAILED, SKIPPED, DUPLICATE… */
  result: string;
  errorKbn?: number | null;
  durationMs?: number;
  /** Chi tiết (thường là lý do lỗi). */
  detail?: string;
}

/**
 * Định dạng một dòng log service, các cột cách nhau bởi " | ":
 * thời gian | mức | service | mã | việc | kết quả | error_kbn | thời gian chạy | chi tiết
 */
export function formatServiceLine(
  service: LogService,
  entry: ServiceLogEntry,
  code: string | undefined,
  now = new Date(),
): string {
  const errorKbn = entry.errorKbn
    ? `${entry.errorKbn}(${describeErrorKbn(entry.errorKbn)})`
    : '-';
  return [
    now.toISOString(),
    (entry.level ?? (entry.errorKbn ? 'ERROR' : 'INFO')).padEnd(5),
    service.replace('service_', ''),
    code ?? '-',
    oneLine(entry.action),
    entry.result,
    errorKbn,
    entry.durationMs !== undefined ? `${entry.durationMs}ms` : '-',
    entry.detail ? oneLine(entry.detail) : '-',
  ].join(' | ');
}

/** Ghi một dòng vào logs/services/<service>.log. */
export function writeServiceLog(
  service: LogService,
  entry: ServiceLogEntry,
  code = logContext.code(),
): void {
  logFiles.write(
    `services/${service}.log`,
    formatServiceLine(service, entry, code),
  );
}

/**
 * Logger của một lớp thuộc một service.
 * - log/warn/error: như Logger của Nest, ghi ra console và app.log.
 * - record: ghi một dòng vào services/<service>.log.
 */
export class ServiceLogger extends Logger {
  constructor(
    readonly service: LogService,
    className: string,
  ) {
    super(`${service}:${className}`);
  }

  record(entry: ServiceLogEntry): void {
    writeServiceLog(this.service, entry);
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 1000);
}
