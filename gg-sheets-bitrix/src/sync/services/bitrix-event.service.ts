import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { safeEquals } from '../../common/auth/safe-equals';
import { ERROR, LOG, WARN } from '../../common/constants/messages.constant';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import {
  BitrixToSheetService,
  type SyncBackResult,
} from './bitrix-to-sheet.service';

/** Sự kiện Bitrix24 cần đồng bộ về Sheet: lead trên CRM vừa được sửa. */
export const LEAD_EVENTS: readonly string[] = ['ONCRMLEADUPDATE'];

/** Phần cần dùng của request Bitrix24 gửi tới. */
export interface BitrixEvent {
  event: string;
  leadId: string;
  applicationToken: string;
}

export type EventResult =
  | ({ accepted: true } & SyncBackResult)
  | {
      accepted: false;
      reason: 'EVENT_IGNORED' | 'TWO_WAY_OFF' | 'NO_LEAD_ID';
    };

/**
 * Nhận webhook đi của Bitrix24 (real-time, đồng bộ hai chiều). Bitrix24 chỉ gửi
 * tên sự kiện và ID lead (data[FIELDS][ID]), không gửi giá trị đã đổi, nên ứng
 * dụng đọc lead qua crm.lead.get rồi mới ghi Sheet.
 *
 * Các sự kiện được xử lý lần lượt (hàng đợi trong tiến trình): sales sửa nhiều
 * lead một lúc thì các lần ghi Sheet không chen nhau.
 */
@Injectable()
export class BitrixEventService {
  private readonly logger = new ServiceLogger(
    LogService.SYNC,
    BitrixEventService.name,
  );
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly syncBack: BitrixToSheetService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async handle(body: unknown): Promise<EventResult> {
    const expected = this.config.bitrix.outboundToken;
    if (!expected) {
      throw new KbnHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorKbn.CONFIG,
        ERROR.LABEL.NOT_CONFIGURED,
        ERROR.WEBHOOK.NOT_CONFIGURED,
      );
    }
    const event = parseEvent(body);
    if (
      !event.applicationToken ||
      !safeEquals(event.applicationToken, expected)
    ) {
      throw new KbnHttpException(
        HttpStatus.UNAUTHORIZED,
        ErrorKbn.UNAUTHORIZED,
        'UNAUTHORIZED',
        ERROR.WEBHOOK.TOKEN_INVALID,
      );
    }
    if (!LEAD_EVENTS.includes(event.event)) {
      this.logger.warn(WARN.WEBHOOK.IGNORED_EVENT(event.event || '-'));
      return { accepted: false, reason: 'EVENT_IGNORED' };
    }
    if (this.config.sync.direction !== 'both') {
      this.logger.warn(WARN.WEBHOOK.TWO_WAY_OFF);
      return { accepted: false, reason: 'TWO_WAY_OFF' };
    }
    const leadId = Number(event.leadId);
    if (!Number.isInteger(leadId) || leadId <= 0) {
      return { accepted: false, reason: 'NO_LEAD_ID' };
    }

    this.logger.log(LOG.WEBHOOK.RECEIVED(event.event, event.leadId));
    const result = await this.enqueue(() => this.syncBack.syncLead(leadId));
    return { accepted: true, ...result };
  }

  /** Chạy `task` sau các sự kiện trước đó; lỗi của sự kiện trước không chặn sự kiện sau. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/**
 * Đọc request của Bitrix24. Webhook đi gửi form-urlencoded
 * (event=…&data[FIELDS][ID]=…&auth[application_token]=…); Express đã đổi
 * thành object lồng nhau giống bản JSON trong tài liệu Bitrix24.
 */
export function parseEvent(body: unknown): BitrixEvent {
  const root = asObject(body);
  const data = asObject(root.data);
  const fields = asObject(data.FIELDS);
  const auth = asObject(root.auth);
  return {
    event: text(root.event).toUpperCase(),
    leadId: text(fields.ID),
    applicationToken: text(auth.application_token),
  };
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
