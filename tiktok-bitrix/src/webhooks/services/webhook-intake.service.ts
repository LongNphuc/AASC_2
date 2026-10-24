import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';
import { LOG, WARN } from '../../common/constants/messages.constant';
import { WebhookStatusKbn } from '../../common/kbn/status.kbn';
import {
  BITRIX_EVENT_TYPES,
  SourceKbn,
  TIKTOK_EVENT_TYPES,
} from '../../common/kbn/type.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { PipelineQueueService } from '../../queues/services/pipeline-queue.service';
import { WebhookEvent } from '../entities/webhook-event.entity';
import {
  withoutBitrixToken,
  type TiktokWebhookBody,
} from '../helpers/webhook-body';

export interface TiktokAcceptResult {
  received: true;
  eventId?: string;
  duplicate?: true;
  ignored?: true;
}

/** Sự kiện chưa xong: TikTok gửi lại thì đẩy lại job (lần trước đẩy job chưa được). */
const UNFINISHED = new Set<number>([
  WebhookStatusKbn.RECEIVED,
  WebhookStatusKbn.FAILED,
]);

/**
 * Bước chung của mọi webhook (readme_design.md mục 3.2, 7): một câu INSERT
 * và một lệnh đẩy job, vài mili giây. DB hoặc Redis lỗi thì ném lỗi ra để
 * trả 500: TikTok gửi lại, cơ chế gửi lại đó chính là đường phục hồi.
 */
@Injectable()
export class WebhookIntakeService {
  private readonly logger = new ServiceLogger(
    LogService.WEBHOOK,
    WebhookIntakeService.name,
  );

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly events: Repository<WebhookEvent>,
    private readonly queue: PipelineQueueService,
  ) {}

  async acceptTiktok(
    body: TiktokWebhookBody,
    headers: Record<string, string>,
  ): Promise<TiktokAcceptResult> {
    const eventName = typeof body.event === 'string' ? body.event : null;
    const eventType = eventName ? TIKTOK_EVENT_TYPES[eventName] : undefined;
    const startedAt = Date.now();

    if (!eventType) {
      await this.insert({
        providerKbn: SourceKbn.TIKTOK,
        eventId: body.event_id,
        eventName,
        eventTypeKbn: null,
        payload: body,
        headers,
        statusKbn: WebhookStatusKbn.IGNORED,
        processedAt: new Date(),
      });
      this.record(`tiktok ${eventName ?? '-'}`, 'IGNORED', startedAt);
      this.logger.log(LOG.WEBHOOK.IGNORED(eventName ?? '-'));
      return { received: true, ignored: true };
    }

    const uuid = await this.insert({
      providerKbn: SourceKbn.TIKTOK,
      eventId: body.event_id,
      eventName,
      eventTypeKbn: eventType,
      payload: body,
      headers,
      statusKbn: WebhookStatusKbn.RECEIVED,
    });
    if (uuid) {
      await this.queue.enqueue({
        uuid,
        providerKbn: SourceKbn.TIKTOK,
        eventId: body.event_id,
      });
      this.record(`tiktok ${eventName}`, 'ACCEPTED', startedAt);
      return { received: true, eventId: body.event_id };
    }

    const existing = await this.events.findOneByOrFail({
      providerKbn: SourceKbn.TIKTOK,
      eventId: body.event_id,
    });
    if (UNFINISHED.has(existing.statusKbn)) {
      // Job đang chờ thì giữ nguyên; job ở DLQ thì chạy lại; mất job thì thêm lại.
      const action = await this.queue.requeue(existing);
      this.record(
        `tiktok ${eventName}`,
        action === 'skipped' ? 'DUPLICATE' : 'REQUEUED',
        startedAt,
        action === 'skipped'
          ? LOG.WEBHOOK.DUPLICATE('job đang chờ')
          : LOG.WEBHOOK.REQUEUED(action),
      );
    } else {
      this.record(
        `tiktok ${eventName}`,
        'DUPLICATE',
        startedAt,
        LOG.WEBHOOK.DUPLICATE(WebhookStatusKbn[existing.statusKbn]),
      );
    }
    return { received: true, eventId: body.event_id, duplicate: true };
  }

  /**
   * Webhook Bitrix24: mỗi request là một job, không chống trùng; job luôn đọc
   * trạng thái mới nhất của deal từ Bitrix24 (readme_design.md mục 7).
   */
  async acceptBitrixDeal(
    body: Record<string, unknown>,
  ): Promise<{ received: true; ignored?: true }> {
    const eventName = typeof body.event === 'string' ? body.event : '';
    const eventType = BITRIX_EVENT_TYPES[eventName.toUpperCase()];
    const startedAt = Date.now();
    if (!eventType) {
      this.logger.log(WARN.WEBHOOK.BITRIX_IGNORED(eventName || '-'));
      this.record(`bitrix24 ${eventName || '-'}`, 'IGNORED', startedAt);
      return { received: true, ignored: true };
    }
    const fields = (body.data as { FIELDS?: { ID?: unknown } } | undefined)
      ?.FIELDS;
    const dealId = Number(fields?.ID);
    const eventId = randomUUID();
    const uuid = await this.insert({
      providerKbn: SourceKbn.BITRIX24,
      eventId,
      eventName: eventName.toUpperCase(),
      eventTypeKbn: eventType,
      payload: withoutBitrixToken(body),
      headers: null,
      bitrixDealId: Number.isInteger(dealId) && dealId > 0 ? dealId : null,
      statusKbn: WebhookStatusKbn.RECEIVED,
    });
    await this.queue.enqueue({
      uuid: uuid!,
      providerKbn: SourceKbn.BITRIX24,
      eventId,
    });
    this.record(
      `bitrix24 ${eventName} deal ${fields?.ID as string}`,
      'ACCEPTED',
      startedAt,
    );
    return { received: true };
  }

  /** INSERT … ON CONFLICT (provider_kbn, event_id) DO NOTHING RETURNING uuid. */
  private async insert(
    values: Partial<WebhookEvent>,
  ): Promise<string | undefined> {
    const result = await this.events
      .createQueryBuilder()
      .insert()
      .into(WebhookEvent)
      .values(values)
      .orIgnore()
      .returning(['uuid'])
      .execute();
    const rows = result.raw as { uuid: string }[];
    return rows[0]?.uuid;
  }

  private record(
    action: string,
    result: string,
    startedAt: number,
    detail?: string,
  ): void {
    this.logger.record({
      action,
      result,
      durationMs: Date.now() - startedAt,
      detail,
    });
  }
}
