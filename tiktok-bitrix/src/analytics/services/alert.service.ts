import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AlertTypeKbn } from '../../common/kbn/type.kbn';
import {
  LogService,
  writeServiceLog,
} from '../../common/logging/service-logger';
import type { JsonObject } from '../../database/json';
import { Alert } from '../entities/alert.entity';

/** Cùng loại cảnh báo cho cùng đối tượng chỉ ghi một lần mỗi giờ (mục 9.8). */
const DEDUPE_WINDOW_MS = 3_600_000;

/**
 * Nơi ghi log của từng loại cảnh báo: app.log (log hệ thống), hoặc
 * services/<service>.log (log của service liên quan).
 */
export const ALERT_LOG: Record<AlertTypeKbn, LogService | 'app'> = {
  [AlertTypeKbn.CPL_HIGH]: 'app',
  [AlertTypeKbn.WORKER_DOWN]: 'app',
  [AlertTypeKbn.CONVERSION_DROP]: LogService.ANALYTICS,
  [AlertTypeKbn.DLQ_NOT_EMPTY]: LogService.JOB,
  [AlertTypeKbn.SYNC_FAILED]: LogService.JOB,
};

/**
 * Tạo cảnh báo: lưu bảng alerts (GET /api/v1/alerts, dashboard) rồi ghi log
 * mức WARN theo ALERT_LOG. Cảnh báo là việc của người vận hành ứng dụng,
 * không phải của sales, nên không gửi thông báo lên Bitrix24. `fingerprint`
 * là loại + đối tượng (campaign, sự kiện…): trùng trong một giờ thì bỏ qua.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
  ) {}

  async raise(
    type: AlertTypeKbn,
    subject: string,
    message: string,
    details: JsonObject = {},
  ): Promise<Alert | null> {
    const fingerprint = `${AlertTypeKbn[type]}:${subject}`;
    const recent = await this.alerts
      .createQueryBuilder('a')
      .where('a.fingerprint = :fingerprint', { fingerprint })
      .andWhere('a.created_at > :since', {
        since: new Date(Date.now() - DEDUPE_WINDOW_MS),
      })
      .getCount();
    if (recent > 0) return null;
    const alert = await this.alerts.save(
      this.alerts.create({ typeKbn: type, fingerprint, message, details }),
    );
    const target = ALERT_LOG[type];
    if (target === 'app') {
      this.logger.warn(`${AlertTypeKbn[type]}: ${message}`);
    } else {
      writeServiceLog(target, {
        level: 'WARN',
        action: `cảnh báo ${AlertTypeKbn[type]}`,
        result: 'ALERT',
        detail: message,
      });
    }
    return alert;
  }
}
