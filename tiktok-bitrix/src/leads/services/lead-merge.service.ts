import { Injectable } from '@nestjs/common';
import { slugify } from '../../common/text/slugify';
import type { Lead } from '../entities/lead.entity';
import type { SubmissionAnswer } from '../entities/lead-submission.entity';
import type { NormalizedLeadEvent } from '../types/lead-event.types';

/** Thông tin một người lấy từ một lượt gửi. */
export interface CustomerData {
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
}

const CUSTOMER_FIELDS = ['name', 'email', 'phone', 'city'] as const;

export function customerDataOf(event: NormalizedLeadEvent): CustomerData {
  return {
    name: event.lead_data.full_name,
    email: event.lead_data.email ?? null,
    phone: event.lead_data.phone ?? null,
    city: event.lead_data.city ?? null,
  };
}

export function answersOf(event: NormalizedLeadEvent): SubmissionAnswer[] {
  return event.custom_questions.map((q) => ({
    question: q.question,
    slug: slugify(q.question),
    answer: q.answer,
  }));
}

/** form.complete: thêm câu mới, câu cũ (cùng slug) lấy giá trị mới. */
export function mergeAnswers(
  current: SubmissionAnswer[],
  incoming: SubmissionAnswer[],
): SubmissionAnswer[] {
  const result = current.map((a) => ({ ...a }));
  for (const answer of incoming) {
    const existing = result.find((a) => a.slug === answer.slug);
    if (existing) {
      existing.answer = answer.answer || existing.answer;
      existing.question = answer.question;
    } else {
      result.push(answer);
    }
  }
  return result;
}

/**
 * Gộp dữ liệu một lượt gửi vào khách theo thời điểm gửi form, không theo thứ
 * tự xử lý (readme_design.md mục 4.4):
 * - khách mới: lấy từ lượt gửi;
 * - lượt gửi mới hơn hoặc bằng lần gửi cuối: giá trị khác rỗng ghi đè, ô trống
 *   không xóa dữ liệu cũ;
 * - lượt gửi cũ hơn (TikTok gửi lại muộn, dữ liệu import): chỉ điền ô trống.
 */
@Injectable()
export class LeadMergeService {
  merge(
    lead: Pick<
      Lead,
      (typeof CUSTOMER_FIELDS)[number] | 'firstSubmittedAt' | 'lastSubmittedAt'
    > | null,
    data: CustomerData,
    submittedAt: Date,
  ): CustomerData & { firstSubmittedAt: Date; lastSubmittedAt: Date } {
    if (!lead) {
      return {
        ...data,
        firstSubmittedAt: submittedAt,
        lastSubmittedAt: submittedAt,
      };
    }
    const newer = submittedAt.getTime() >= lead.lastSubmittedAt.getTime();
    const merged = { ...lead } as CustomerData;
    for (const field of CUSTOMER_FIELDS) {
      const incoming = data[field];
      if (!incoming) continue;
      if (newer || !lead[field]) merged[field] = incoming;
    }
    return {
      name: merged.name,
      email: merged.email,
      phone: merged.phone,
      city: merged.city,
      firstSubmittedAt:
        submittedAt < lead.firstSubmittedAt
          ? submittedAt
          : lead.firstSubmittedAt,
      lastSubmittedAt: newer ? submittedAt : lead.lastSubmittedAt,
    };
  }
}
