import { Logger } from '@nestjs/common';
import { describeErrorKbn } from '../kbn/error.kbn';
import { StatusKbn } from '../kbn/status.kbn';
import { logFiles } from './log-files';
import { requestContext } from './request-context';

/** Các service có tệp log riêng trong logs/services/. */
export enum LogService {
  /** Mỗi lần chạy: từng bước, tổng kết, lỗi từng hàng. */
  SYNC = 'service_sync',
  /** Từng lệnh gọi Google. */
  GOOGLE = 'service_google',
  /** Từng lệnh gọi Bitrix24. */
  BITRIX = 'service_bitrix',
  /** Request vào /sync, /mapping, /google, /bitrix. */
  API = 'service_api',
}

/** Một dòng trong services/<service>.log. */
export interface ServiceLogEntry {
  /** Việc vừa làm, ví dụ "POST /sync/run 202" hoặc "crm.lead.add". */
  method: string;
  statusKbn: StatusKbn;
  errorKbn?: number | null;
  durationMs?: number;
  /** Chi tiết (thường là lý do lỗi). */
  errorDetail?: string;
}

/**
 * Định dạng một dòng log service, các cột cách nhau bởi " | ":
 * thời gian | mã | việc | status_kbn | error_kbn | thời gian chạy | chi tiết
 */
export function formatServiceLine(
  entry: ServiceLogEntry,
  id: string | undefined,
  now = new Date(),
): string {
  const errorKbn = entry.errorKbn
    ? `${entry.errorKbn}(${describeErrorKbn(entry.errorKbn)})`
    : '-';
  return [
    now.toISOString(),
    id ?? '-',
    entry.method,
    `status_kbn=${entry.statusKbn}(${StatusKbn[entry.statusKbn]})`,
    `error_kbn=${errorKbn}`,
    entry.durationMs !== undefined ? `${entry.durationMs}ms` : '-',
    entry.errorDetail ? oneLine(entry.errorDetail) : '-',
  ].join(' | ');
}

/** Ghi một dòng vào logs/services/<service>.log. */
export function writeServiceLog(
  service: LogService,
  entry: ServiceLogEntry,
  id = requestContext.requestId(),
): void {
  logFiles.write(`services/${service}.log`, formatServiceLine(entry, id));
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
