import { EVENT_TYPE_NAMES } from '../common/kbn/type.kbn';
import type { LeadSubmission } from '../leads/entities/lead-submission.entity';

/**
 * Ngữ cảnh để đánh giá điều kiện rule: payload của CHÍNH lượt gửi (không phải
 * dữ liệu khách mới nhất), vì mỗi lượt gửi có campaign riêng (mục 6.1), thêm
 * answers.<slug> và quality_score.
 */
export function buildRuleContext(
  submission: LeadSubmission,
): Record<string, unknown> {
  return {
    event: EVENT_TYPE_NAMES[submission.eventTypeKbn],
    event_id: submission.externalId,
    timestamp: Math.floor(submission.submittedAt.getTime() / 1000),
    advertiser_id: submission.advertiserId,
    campaign: {
      campaign_id: submission.campaignId,
      campaign_name: submission.campaignName,
      ad_id: submission.adId,
      ad_name: submission.adName,
    },
    form: { form_id: submission.formId, form_name: submission.formName },
    lead_data: {
      full_name: submission.name,
      email: submission.email,
      phone: submission.phone,
      city: submission.city,
      interests: submission.interests,
      utm_source: submission.utmSource,
      utm_campaign: submission.utmCampaign,
      ttclid: submission.ttclid,
    },
    custom_questions: submission.answers.map(
      (a) => `${a.question}: ${a.answer}`,
    ),
    answers: Object.fromEntries(
      submission.answers.map((a) => [a.slug, a.answer]),
    ),
    quality_score: submission.qualityScore,
  };
}
