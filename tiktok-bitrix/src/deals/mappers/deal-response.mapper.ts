import { DealStatusKbn } from '../../common/kbn/status.kbn';
import {
  DealOriginKbn,
  EVENT_TYPE_NAMES,
  kbnName,
} from '../../common/kbn/type.kbn';
import type { Lead } from '../../leads/entities/lead.entity';
import type { LeadSubmission } from '../../leads/entities/lead-submission.entity';
import type { Deal } from '../entities/deal.entity';

/** Một deal trong GET /api/v1/deals (readme_api.md mục 5). */
export function toDealItem(
  deal: Deal,
  lead: Pick<Lead, 'uuid' | 'name' | 'bitrix24Id'> | null,
  origin: LeadSubmission | null,
  attachedSubmissionCount: number,
) {
  return {
    uuid: deal.uuid,
    bitrix24Id: deal.bitrix24Id,
    title: deal.title,
    lead: lead
      ? { uuid: lead.uuid, name: lead.name, bitrix24Id: lead.bitrix24Id }
      : null,
    pipelineId: deal.pipelineId,
    stage: deal.stage,
    status: kbnName(DealStatusKbn, deal.statusKbn),
    statusKbn: deal.statusKbn,
    origin: kbnName(DealOriginKbn, deal.originKbn),
    probability: deal.probability,
    amount: deal.amount,
    currency: deal.currency,
    assignedTo: deal.assignedTo,
    originSubmission: origin
      ? {
          uuid: origin.uuid,
          campaignId: origin.campaignId,
          campaignName: origin.campaignName,
          eventType: EVENT_TYPE_NAMES[origin.eventTypeKbn] ?? null,
        }
      : null,
    attachedSubmissionCount,
    ruleSnapshot: deal.ruleSnapshot,
    createdAt: deal.createdAt,
    closedAt: deal.closedAt,
  };
}
