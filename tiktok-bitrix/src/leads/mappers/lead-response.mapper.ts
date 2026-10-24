import { LeadStatusKbn, StatusKbn } from '../../common/kbn/status.kbn';
import {
  EVENT_TYPE_NAMES,
  kbnName,
  SourceKbn,
} from '../../common/kbn/type.kbn';
import type { Lead } from '../entities/lead.entity';
import type { LeadSubmission } from '../entities/lead-submission.entity';

/** Trạng thái đồng bộ của lượt gửi trong API: SUCCESS gọi là "synced". */
export const SYNC_STATUS_NAMES: Record<number, string> = {
  [StatusKbn.PENDING]: 'pending',
  [StatusKbn.SUCCESS]: 'synced',
  [StatusKbn.FAILED]: 'failed',
};

export const SYNC_STATUS_BY_NAME: Record<string, StatusKbn> = {
  pending: StatusKbn.PENDING,
  synced: StatusKbn.SUCCESS,
  failed: StatusKbn.FAILED,
};

export function sourceName(channelKbn: number): string | null {
  return kbnName(SourceKbn, channelKbn);
}

/** Một lượt gửi trong GET /api/v1/leads/:uuid. */
export function toSubmissionItem(s: LeadSubmission) {
  return {
    uuid: s.uuid,
    eventType: EVENT_TYPE_NAMES[s.eventTypeKbn] ?? null,
    source: sourceName(s.channelKbn),
    externalId: s.externalId,
    campaignId: s.campaignId,
    campaignName: s.campaignName,
    adId: s.adId,
    adName: s.adName,
    formId: s.formId,
    formName: s.formName,
    answers: s.answers.map(({ question, answer }) => ({ question, answer })),
    qualityScore: s.qualityScore,
    syncStatus: SYNC_STATUS_NAMES[s.syncStatusKbn] ?? null,
    errorKbn: s.errorKbn,
    warnings: s.warnings,
    dealUuid: s.dealUuid,
    submittedAt: s.submittedAt,
    completedAt: s.completedAt,
    syncedAt: s.syncedAt,
  };
}

/** Phần tóm tắt các lượt gửi của một khách (đếm, nguồn, lượt mới nhất, deal mở). */
export interface LeadSummary {
  submissionCount: number;
  channels: number[];
  latest: LeadSubmission | null;
  openDealCount: number;
}

/** Một khách trong GET /api/v1/leads (readme_api.md mục 4). */
export function toLeadItem(lead: Lead, summary: LeadSummary) {
  const latest = summary.latest;
  return {
    uuid: lead.uuid,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    city: lead.city,
    sources: summary.channels.map(sourceName).filter(Boolean),
    status: kbnName(LeadStatusKbn, lead.statusKbn),
    statusKbn: lead.statusKbn,
    bitrix24Id: lead.bitrix24Id,
    submissionCount: summary.submissionCount,
    qualityScore: latest?.qualityScore ?? null,
    latestSubmission: latest
      ? {
          uuid: latest.uuid,
          campaignId: latest.campaignId,
          campaignName: latest.campaignName,
          adName: latest.adName,
          formName: latest.formName,
          submittedAt: latest.submittedAt,
          syncStatus: SYNC_STATUS_NAMES[latest.syncStatusKbn] ?? null,
        }
      : null,
    openDealCount: summary.openDealCount,
    firstSubmittedAt: lead.firstSubmittedAt,
    lastSubmittedAt: lead.lastSubmittedAt,
  };
}
