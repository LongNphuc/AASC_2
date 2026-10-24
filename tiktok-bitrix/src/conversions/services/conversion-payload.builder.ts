import { createHash } from 'node:crypto';
import type { Deal } from '../../deals/entities/deal.entity';
import type { LeadSubmission } from '../../leads/entities/lead-submission.entity';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/**
 * Body của Events API cho một sự kiện CRM (readme_design.md mục 8):
 * - lead.lead_id: ID lead phía TikTok; payload của đề không có trường này nên
 *   dùng external_id (= event_id) của lượt gửi đã tạo ra deal;
 * - email, SĐT băm SHA-256 sau khi chuẩn hóa (chữ thường; E.164), không gửi
 *   giá trị gốc;
 * - event_id cố định theo deal và loại sự kiện: gửi lại không bị đếm trùng.
 */
export function buildConversionPayload(input: {
  eventSetId: string;
  eventName: string;
  eventId: string;
  eventTime: Date;
  deal: Deal;
  submission: LeadSubmission;
}): Record<string, unknown> {
  const { submission, deal } = input;
  return {
    event_source: 'crm',
    event_source_id: input.eventSetId,
    data: [
      {
        event: input.eventName,
        event_time: Math.floor(input.eventTime.getTime() / 1000),
        event_id: input.eventId,
        lead: { lead_id: submission.externalId, lead_event_source: 'Bitrix24' },
        user: {
          ...(submission.email
            ? { email: [sha256(submission.email.trim().toLowerCase())] }
            : {}),
          ...(submission.phone ? { phone: [sha256(submission.phone)] } : {}),
        },
        properties: { value: deal.amount ?? 0, currency: deal.currency },
      },
    ],
  };
}
