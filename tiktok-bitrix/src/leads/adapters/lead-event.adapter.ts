import type { FieldError } from '../types/lead-event.types';

/** Ứng viên dạng chuẩn sau khi đọc payload ngoài và làm sạch, chưa validate. */
export interface LeadEventCandidate {
  event: string;
  event_id: unknown;
  timestamp: unknown;
  advertiser_id?: string;
  campaign: Record<string, string | undefined>;
  form: Record<string, string | undefined>;
  lead_data: {
    full_name?: string;
    email?: string;
    phone?: string;
    city?: string;
    interests?: string[];
    utm_source?: string;
    utm_campaign?: string;
    ttclid?: string;
  };
  custom_questions: { question: string; answer: string }[];
  channelKbn: number;
}

export interface InteractionCandidate {
  event_id: unknown;
  timestamp: unknown;
  type: unknown;
  advertiser_id?: string;
  campaign_id?: string;
  ad_id?: string;
  form_id?: string;
  ttclid?: string;
}

/**
 * Đổi payload của một nguồn (webhook theo đề, payload thật của TikTok, tệp
 * import) thành dạng chuẩn. Thêm nguồn mới chỉ cần thêm adapter
 * (readme_design.md mục 4.1).
 */
export interface LeadEventAdapter {
  toLeadEvent(
    payload: Record<string, unknown>,
    providerKbn: number,
  ): LeadEventCandidate | FieldError[];
  toInteraction(payload: Record<string, unknown>): InteractionCandidate;
}
