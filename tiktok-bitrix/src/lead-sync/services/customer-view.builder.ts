import { EVENT_TYPE_NAMES } from '../../common/kbn/type.kbn';
import type { Lead } from '../../leads/entities/lead.entity';
import type { LeadSubmission } from '../../leads/entities/lead-submission.entity';

/** Dữ liệu khách đem đi map, cùng cấu trúc với payload chuẩn (readme_design.md mục 5.1). */
export interface CustomerView {
  event?: string;
  event_id: string;
  timestamp: number;
  advertiser_id?: string | null;
  campaign: Record<string, string | null>;
  form: Record<string, string | null>;
  lead_data: Record<string, unknown>;
  custom_questions: { question: string; answer: string }[];
  answers: Record<string, string>;
}

/**
 * Bản mới nhất của khách, ghép từ hai nơi: tên, email, SĐT, thành phố từ
 * leads (bản đã gộp); phần còn lại từ lượt gửi có submitted_at lớn nhất.
 * Job không đẩy dữ liệu của chính lượt gửi đang xử lý, nên lượt gửi cũ tới
 * muộn không ghi đè dữ liệu mới hơn trên Bitrix24 (readme_improvements.md mục 6).
 */
export function buildCustomerView(
  lead: Lead,
  latest: LeadSubmission,
): CustomerView {
  return {
    event: EVENT_TYPE_NAMES[latest.eventTypeKbn],
    event_id: latest.externalId,
    timestamp: Math.floor(latest.submittedAt.getTime() / 1000),
    advertiser_id: latest.advertiserId,
    campaign: {
      campaign_id: latest.campaignId,
      campaign_name: latest.campaignName,
      ad_id: latest.adId,
      ad_name: latest.adName,
    },
    form: { form_id: latest.formId, form_name: latest.formName },
    lead_data: {
      full_name: lead.name,
      email: lead.email,
      phone: lead.phone,
      city: lead.city,
      interests: latest.interests,
      utm_source: latest.utmSource,
      utm_campaign: latest.utmCampaign,
      ttclid: latest.ttclid,
    },
    custom_questions: latest.answers.map(({ question, answer }) => ({
      question,
      answer,
    })),
    answers: Object.fromEntries(latest.answers.map((a) => [a.slug, a.answer])),
  };
}
