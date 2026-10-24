import type { SubmissionWarning } from '../entities/lead-submission.entity';

/**
 * Dạng chuẩn của một sự kiện lead cho mọi bước sau (readme_design.md mục
 * 4.1). Trùng cấu trúc payload mẫu của đề, vì mapping của đề dùng đường dẫn
 * như lead_data.email, campaign.campaign_name.
 */
export interface NormalizedLeadEvent {
  event: 'lead.generate' | 'form.complete';
  event_id: string;
  /** Giây. */
  timestamp: number;
  advertiser_id?: string;
  campaign: {
    campaign_id?: string;
    campaign_name?: string;
    ad_id?: string;
    ad_name?: string;
  };
  form: { form_id?: string; form_name?: string };
  lead_data: {
    full_name: string;
    email?: string;
    phone?: string;
    city?: string;
    interests?: string[];
    utm_source?: string;
    utm_campaign?: string;
    ttclid?: string;
  };
  custom_questions: { question: string; answer: string }[];
  /** Kênh khách đến: TikTok, hoặc kênh khác khi nhập dữ liệu cũ (mục 9.9). */
  channelKbn: number;
}

/** Sự kiện user.interaction (readme_design.md mục 3.1). */
export interface NormalizedInteraction {
  event_id: string;
  timestamp: number;
  advertiser_id?: string;
  campaign_id?: string;
  ad_id?: string;
  form_id?: string;
  type: 'ad_click' | 'form_open';
  ttclid?: string;
}

/** Lỗi validate một trường. */
export interface FieldError {
  field: string;
  message: string;
}

export type NormalizeResult<T> =
  | { ok: true; value: T; warnings: SubmissionWarning[] }
  | { ok: false; errorKbn: number; errors: FieldError[] };

/**
 * Đường dẫn dùng được trong mapping và điều kiện rule (mục 5.1, 6.1). Thêm
 * `answers.<slug câu hỏi>` (kiểm bằng ANSWER_PATH) và, riêng với rule,
 * `quality_score`.
 */
export const LEAD_EVENT_PATHS = [
  'event',
  'event_id',
  'timestamp',
  'advertiser_id',
  'campaign.campaign_id',
  'campaign.campaign_name',
  'campaign.ad_id',
  'campaign.ad_name',
  'form.form_id',
  'form.form_name',
  'lead_data.full_name',
  'lead_data.email',
  'lead_data.phone',
  'lead_data.city',
  'lead_data.interests',
  'lead_data.utm_source',
  'lead_data.utm_campaign',
  'lead_data.ttclid',
  'custom_questions',
] as const;

export const ANSWER_PATH = /^answers\.[a-z0-9_]+$/;
