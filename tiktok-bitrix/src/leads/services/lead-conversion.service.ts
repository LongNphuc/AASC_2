import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ERROR } from '../../common/constants/messages.constant';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { WebhookStatusKbn } from '../../common/kbn/status.kbn';
import { SourceKbn } from '../../common/kbn/type.kbn';
import {
  DealRulesService,
  resolvePipeline,
} from '../../deals/services/deal-rules.service';
import {
  submissionForConversion,
  type ConvertRequest,
} from '../../pipeline/jobs/convert-deal.job';
import { PipelineQueueService } from '../../queues/services/pipeline-queue.service';
import { WebhookEvent } from '../../webhooks/entities/webhook-event.entity';
import type { ConvertToDealDto } from '../dto/convert-to-deal.dto';
import { Lead } from '../entities/lead.entity';

/**
 * POST /api/v1/leads/:uuid/convert-to-deal, phía api (readme_design.md mục
 * 6.7): kiểm điều kiện bằng lệnh đọc (DB, và Bitrix24 cho deal đang mở), ghi
 * yêu cầu thành một dòng webhook_events (provider MANUAL, event_id = dealUuid
 * sinh sẵn) rồi đẩy job convert-deal. api không ghi khách, lượt gửi, deal.
 */
@Injectable()
export class LeadConversionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly dealRules: DealRulesService,
    private readonly queue: PipelineQueueService,
  ) {}

  async request(
    leadUuid: string,
    body: ConvertToDealDto,
  ): Promise<{ dealUuid: string; status: 'queued' }> {
    const manager = this.dataSource.manager;
    const lead = await manager.findOneBy(Lead, { uuid: leadUuid });
    if (!lead) throw notFound(ERROR.LEAD.NOT_FOUND(leadUuid));
    if (!lead.bitrix24Id) {
      throw new KbnHttpException(
        409,
        ErrorKbn.LEAD_NOT_IN_CRM,
        ERROR.LABEL.LEAD_NOT_IN_CRM,
        ERROR.DEAL.LEAD_NOT_IN_CRM,
      );
    }
    const submission = await submissionForConversion(
      manager,
      lead.uuid,
      body.lead_submission_uuid,
    );
    if (!submission && body.lead_submission_uuid) {
      throw notFound(
        ERROR.LEAD.SUBMISSION_NOT_FOUND(body.lead_submission_uuid),
      );
    }
    if (!submission || submission.dealUuid) {
      throw new KbnHttpException(
        409,
        ErrorKbn.SUBMISSION_HAS_DEAL,
        ERROR.LABEL.SUBMISSION_HAS_DEAL,
        ERROR.DEAL.SUBMISSION_HAS_DEAL,
        submission?.dealUuid ? { dealUuid: submission.dealUuid } : undefined,
      );
    }

    const rules = await this.dealRules.rules();
    const matched = this.dealRules.matchRule(rules, submission);
    const pipelineId = resolvePipeline(rules, matched, body.pipeline_id);
    const stages = rules.stage_probability[pipelineId];
    if (
      (body.pipeline_id && !stages) ||
      (body.stage_id && !(stages && body.stage_id in stages))
    ) {
      throw new KbnHttpException(
        400,
        ErrorKbn.CONFIG_INVALID,
        ERROR.LABEL.CONFIG_INVALID,
        ERROR.DEAL.STAGE_UNKNOWN(pipelineId, body.stage_id ?? '-'),
      );
    }
    // Deal mở trên DB mà đã thắng, thua hoặc bị xóa trên CRM thì không tính.
    const open = await this.dealRules.findOpenDeal(
      manager,
      lead.uuid,
      pipelineId,
    );
    if (open.deal) {
      throw new KbnHttpException(
        409,
        ErrorKbn.DEAL_ALREADY_OPEN,
        ERROR.LABEL.DEAL_ALREADY_OPEN,
        ERROR.DEAL.ALREADY_OPEN(pipelineId),
        { dealUuid: open.deal.uuid },
      );
    }

    const dealUuid = randomUUID();
    const payload: ConvertRequest = { lead_uuid: lead.uuid, ...body };
    const inserted = await manager
      .createQueryBuilder()
      .insert()
      .into(WebhookEvent)
      .values({
        providerKbn: SourceKbn.MANUAL,
        eventId: dealUuid,
        eventName: 'convert-to-deal',
        payload: payload as never,
        statusKbn: WebhookStatusKbn.RECEIVED,
      })
      .returning(['uuid'])
      .execute();
    const uuid = (inserted.raw as { uuid: string }[])[0].uuid;
    await this.queue.enqueue({
      uuid,
      providerKbn: SourceKbn.MANUAL,
      eventId: dealUuid,
    });
    return { dealUuid, status: 'queued' };
  }
}

function notFound(message: string): KbnHttpException {
  return new KbnHttpException(
    404,
    ErrorKbn.NOT_FOUND,
    ERROR.LABEL.NOT_FOUND,
    message,
  );
}
