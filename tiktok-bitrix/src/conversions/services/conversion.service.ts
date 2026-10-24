import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AlertService } from '../../analytics/services/alert.service';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { errorKbnOf } from '../../common/kbn/error.kbn';
import { StatusKbn } from '../../common/kbn/status.kbn';
import {
  AlertTypeKbn,
  ConversionKbn,
  SourceKbn,
} from '../../common/kbn/type.kbn';
import { CONVERSION } from '../../common/constants/messages.constant';
import { appConfig, type AppConfig } from '../../config/app-config';
import { jsonValue } from '../../database/json';
import type { Deal } from '../../deals/entities/deal.entity';
import { LeadSubmission } from '../../leads/entities/lead-submission.entity';
import { WebhookEvent } from '../../webhooks/entities/webhook-event.entity';
import { TiktokEventsClient } from '../clients/tiktok-events.client';
import { ConversionEvent } from '../entities/conversion-event.entity';
import { buildConversionPayload } from './conversion-payload.builder';

/**
 * Báo conversion về TikTok (readme_design.md mục 8): ghi conversion_events
 * PENDING (UNIQUE deal + loại), chưa SUCCESS thì gửi Events API rồi đặt
 * SUCCESS. Lỗi tạm thời ném ra để job thử lại; lỗi khác đặt FAILED, cảnh
 * báo, không làm hỏng job (lead và deal đã xong).
 */
@Injectable()
export class ConversionService {
  constructor(
    @InjectRepository(ConversionEvent)
    private readonly conversions: Repository<ConversionEvent>,
    @InjectRepository(LeadSubmission)
    private readonly submissions: Repository<LeadSubmission>,
    @InjectRepository(WebhookEvent)
    private readonly events: Repository<WebhookEvent>,
    private readonly client: TiktokEventsClient,
    private readonly alerts: AlertService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async ensureSent(deal: Deal, eventKbn: ConversionKbn): Promise<void> {
    const submission = await this.submissions.findOneByOrFail({
      uuid: deal.leadSubmissionUuid,
    });
    // Chỉ báo cho lượt gửi đến từ webhook TikTok; dữ liệu import không báo,
    // để không đẩy hàng loạt sự kiện cũ lên TikTok.
    const origin = await this.events.findOneBy({
      uuid: submission.webhookEventUuid,
    });
    if (origin?.providerKbn !== SourceKbn.TIKTOK) return;

    const created = eventKbn === ConversionKbn.DEAL_CREATED;
    const eventName = created
      ? this.config.tiktok.eventDealCreated
      : this.config.tiktok.eventDealWon;
    const eventId = `deal-${deal.uuid}-${created ? 'created' : 'won'}`;
    await this.conversions.query(
      `INSERT INTO conversion_events (deal_uuid, lead_submission_uuid, event_kbn, tiktok_event_name, event_id, status_kbn)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (deal_uuid, event_kbn) DO NOTHING`,
      [
        deal.uuid,
        submission.uuid,
        eventKbn,
        eventName,
        eventId,
        StatusKbn.PENDING,
      ],
    );
    const row = await this.conversions.findOneByOrFail({
      dealUuid: deal.uuid,
      eventKbn,
    });
    if (row.statusKbn !== StatusKbn.PENDING) return;

    try {
      const { requestId } = await this.client.track(
        buildConversionPayload({
          eventSetId: this.config.tiktok.crmEventSetId ?? '',
          eventName,
          eventId,
          eventTime: created ? deal.createdAt : (deal.closedAt ?? new Date()),
          deal,
          submission,
        }),
      );
      await this.conversions.update(
        { uuid: row.uuid },
        {
          statusKbn: StatusKbn.SUCCESS,
          tiktokRequestId: requestId ?? null,
          sentAt: new Date(),
          errorKbn: null,
          errorDetail: null,
          updatedAt: new Date(),
        },
      );
    } catch (error) {
      if (error instanceof ExternalApiError && error.transient) throw error;
      const errorKbn = errorKbnOf(error);
      const message = error instanceof Error ? error.message : String(error);
      await this.conversions.update(
        { uuid: row.uuid },
        {
          statusKbn: StatusKbn.FAILED,
          errorKbn,
          errorDetail: jsonValue({ message }),
          updatedAt: new Date(),
        },
      );
      await this.alerts.raise(
        AlertTypeKbn.SYNC_FAILED,
        `conversion:${deal.uuid}`,
        CONVERSION.FAILED(ConversionKbn[eventKbn], errorKbn, message),
        { dealUuid: deal.uuid, errorKbn },
      );
    }
  }
}
