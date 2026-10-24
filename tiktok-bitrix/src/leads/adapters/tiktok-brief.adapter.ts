import { Injectable } from '@nestjs/common';
import { CHANNEL_NAMES, SourceKbn } from '../../common/kbn/type.kbn';
import { cleanText } from '../../common/text/sanitize';
import type {
  InteractionCandidate,
  LeadEventAdapter,
  LeadEventCandidate,
} from './lead-event.adapter';

type Obj = Record<string, unknown>;

const obj = (value: unknown): Obj =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Obj)
    : {};

/** Chuỗi đã làm sạch; rỗng thì undefined (trường không có). */
const str = (value: unknown): string | undefined =>
  cleanText(value) ?? undefined;

/** Giữ kiểu gốc nếu không phải chuỗi/số, để validate báo đúng lỗi kiểu. */
const scalar = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Adapter cho payload mẫu của đề (cùng cấu trúc với dạng chuẩn), cho cả
 * webhook TikTok và tệp import (thêm "channel" tùy chọn: tiktok, facebook,
 * website). Làm sạch mọi chuỗi (bỏ HTML, ký tự điều khiển, gộp khoảng trắng,
 * NFC); ID dạng số đổi thành chuỗi.
 */
@Injectable()
export class TiktokBriefAdapter implements LeadEventAdapter {
  toLeadEvent(payload: Obj, providerKbn: number): LeadEventCandidate {
    const campaign = obj(payload.campaign);
    const form = obj(payload.form);
    const lead = obj(payload.lead_data);
    const interests = Array.isArray(lead.interests)
      ? lead.interests
          .map((item) => cleanText(item))
          .filter((item): item is string => !!item)
      : undefined;
    const questions = Array.isArray(payload.custom_questions)
      ? (payload.custom_questions as unknown[]).map((raw) => {
          const item = obj(raw);
          return {
            question: cleanText(item.question) ?? '',
            answer: cleanText(item.answer) ?? '',
          };
        })
      : [];
    const channelName =
      typeof payload.channel === 'string' ? payload.channel.toLowerCase() : '';
    return {
      event:
        typeof payload.event === 'string' ? payload.event : 'lead.generate',
      event_id: scalar(payload.event_id),
      timestamp: payload.timestamp,
      advertiser_id: str(payload.advertiser_id),
      campaign: {
        campaign_id: str(campaign.campaign_id),
        campaign_name: str(campaign.campaign_name),
        ad_id: str(campaign.ad_id),
        ad_name: str(campaign.ad_name),
      },
      form: { form_id: str(form.form_id), form_name: str(form.form_name) },
      lead_data: {
        full_name: str(lead.full_name),
        email:
          typeof lead.email === 'string'
            ? lead.email.trim() || undefined
            : undefined,
        phone:
          typeof lead.phone === 'string' || typeof lead.phone === 'number'
            ? String(lead.phone).trim() || undefined
            : undefined,
        city: str(lead.city),
        interests,
        utm_source: str(lead.utm_source),
        utm_campaign: str(lead.utm_campaign),
        ttclid: str(lead.ttclid),
      },
      // Bỏ cặp không có câu hỏi; câu trả lời rỗng vẫn giữ (đếm là chưa trả lời).
      custom_questions: questions.filter((q) => q.question),
      channelKbn:
        providerKbn === SourceKbn.IMPORT
          ? (CHANNEL_NAMES[channelName] ?? SourceKbn.TIKTOK)
          : SourceKbn.TIKTOK,
    };
  }

  toInteraction(payload: Obj): InteractionCandidate {
    const campaign = obj(payload.campaign);
    const form = obj(payload.form);
    const interaction = obj(payload.interaction);
    return {
      event_id: scalar(payload.event_id),
      timestamp: payload.timestamp,
      type: interaction.type,
      advertiser_id: str(payload.advertiser_id),
      campaign_id: str(campaign.campaign_id),
      ad_id: str(campaign.ad_id),
      form_id: str(form.form_id),
      ttclid: str(interaction.ttclid),
    };
  }
}
