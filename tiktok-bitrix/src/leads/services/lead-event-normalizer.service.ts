import { Inject, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { VALIDATION } from '../../common/constants/messages.constant';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { SourceKbn } from '../../common/kbn/type.kbn';
import { appConfig, type AppConfig } from '../../config/app-config';
import { TiktokBriefAdapter } from '../adapters/tiktok-brief.adapter';
import { InteractionDto, LeadEventDto } from '../dto/normalized-lead-event.dto';
import type { SubmissionWarning } from '../entities/lead-submission.entity';
import { toValidEmail } from '../transformers/email.transformer';
import { normalizePhone } from '../transformers/phone.transformer';
import type {
  FieldError,
  NormalizedInteraction,
  NormalizedLeadEvent,
  NormalizeResult,
} from '../types/lead-event.types';

/** Phần của dòng webhook_events cần để chuẩn hóa. */
export interface LeadEventSource {
  payload: Record<string, unknown>;
  providerKbn: number;
  eventId: string;
}

/** Mã cảnh báo ghi vào lead_submissions.warnings. */
export const WARNING = {
  EMAIL_INVALID: 'EMAIL_INVALID',
  PHONE_INVALID: 'PHONE_INVALID',
  DUPLICATE_SUSPECT: 'DUPLICATE_SUSPECT',
  LEAD_GONE: 'LEAD_GONE',
  CONTACT_GONE: 'CONTACT_GONE',
  LEAD_UPDATE_REJECTED: 'LEAD_UPDATE_REJECTED',
  COMMENT_REJECTED: 'COMMENT_REJECTED',
} as const;

export function warning(code: string, message: string): SubmissionWarning {
  return { code, message, at: new Date().toISOString() };
}

/**
 * Bước 1 của job tiktok-event (readme_design.md mục 4.1–4.3): payload qua
 * adapter ra dạng chuẩn, validate bằng class-validator, chuẩn hóa email/SĐT.
 * Hàm thuần (chỉ đọc payload), nên bước 2 gọi lại được mà không cần lưu
 * bản chuẩn hóa.
 *
 * Giá trị email/SĐT sai bị bỏ và ghi cảnh báo, lượt gửi vẫn nhận nếu còn giá
 * trị kia: khách gõ sai email nhưng SĐT đúng vẫn là một khách sales gọi được.
 */
@Injectable()
export class LeadEventNormalizer {
  constructor(
    private readonly adapter: TiktokBriefAdapter,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  normalizeLead(event: LeadEventSource): NormalizeResult<NormalizedLeadEvent> {
    const candidate = this.adapter.toLeadEvent(
      event.payload,
      event.providerKbn,
    );
    // Bản ghi import không có event_id: dùng mã import-{hash tệp}-{dòng} của sự kiện.
    if (
      candidate.event_id === undefined &&
      event.providerKbn === SourceKbn.IMPORT
    ) {
      candidate.event_id = event.eventId;
    }
    const errors = validateSync(plainToInstance(LeadEventDto, candidate));
    if (errors.length > 0) {
      return {
        ok: false,
        errorKbn: ErrorKbn.VALIDATION,
        errors: toFieldErrors(errors),
      };
    }

    const warnings: SubmissionWarning[] = [];
    const rawEmail = candidate.lead_data.email;
    const rawPhone = candidate.lead_data.phone;
    const email = toValidEmail(rawEmail);
    const phone = normalizePhone(rawPhone, this.config.lead.phoneRegion);
    if (rawEmail && !email) {
      warnings.push(
        warning(WARNING.EMAIL_INVALID, VALIDATION.EMAIL_DROPPED(rawEmail)),
      );
    }
    if (rawPhone && !phone) {
      warnings.push(
        warning(WARNING.PHONE_INVALID, VALIDATION.PHONE_DROPPED(rawPhone)),
      );
    }
    if (!email && !phone) {
      return {
        ok: false,
        errorKbn: ErrorKbn.NO_CONTACT_INFO,
        errors: [{ field: 'lead_data', message: VALIDATION.NO_CONTACT }],
      };
    }
    return {
      ok: true,
      warnings,
      value: {
        event: candidate.event as NormalizedLeadEvent['event'],
        event_id: String(candidate.event_id),
        timestamp: Number(candidate.timestamp),
        advertiser_id: candidate.advertiser_id,
        campaign: candidate.campaign,
        form: candidate.form,
        lead_data: {
          ...candidate.lead_data,
          full_name: candidate.lead_data.full_name!,
          email: email ?? undefined,
          phone: phone ?? undefined,
        },
        custom_questions: candidate.custom_questions,
        channelKbn: candidate.channelKbn,
      },
    };
  }

  normalizeInteraction(
    payload: Record<string, unknown>,
  ): NormalizeResult<NormalizedInteraction> {
    const candidate = this.adapter.toInteraction(payload);
    const errors = validateSync(plainToInstance(InteractionDto, candidate));
    if (errors.length > 0) {
      return {
        ok: false,
        errorKbn: ErrorKbn.VALIDATION,
        errors: toFieldErrors(errors),
      };
    }
    return {
      ok: true,
      warnings: [],
      value: {
        ...candidate,
        event_id: String(candidate.event_id),
        timestamp: Number(candidate.timestamp),
        type: candidate.type as NormalizedInteraction['type'],
      },
    };
  }
}

function toFieldErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({
      field,
      message,
    }));
    return [...own, ...toFieldErrors(error.children ?? [], field)];
  });
}
