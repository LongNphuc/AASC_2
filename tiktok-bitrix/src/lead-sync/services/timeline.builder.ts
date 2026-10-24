import { MSG } from '../../common/constants/messages.constant';
import { formatLocalDateTime } from '../../common/query/date-range';
import type { LeadSubmission } from '../../leads/entities/lead-submission.entity';
import { WARNING } from '../../leads/services/lead-event-normalizer.service';
import { channelLabel } from './field-mapper.service';

/** Cảnh báo của bước 3a hiện ở dòng "Lưu ý" (lead nghi trùng, lead cũ không còn). */
const NOTE_CODES = new Set<string>([
  WARNING.DUPLICATE_SUSPECT,
  WARNING.LEAD_GONE,
  WARNING.CONTACT_GONE,
  WARNING.LEAD_UPDATE_REJECTED,
]);

function answersText(answers: { question: string; answer: string }[]): string {
  return answers
    .filter((a) => a.answer)
    .map((a) => `${a.question}: ${a.answer}`)
    .join(' · ');
}

function withCode(lines: (string | null)[], code: string): string {
  return [
    ...lines.filter((l): l is string => !!l),
    MSG.TIMELINE.CODE(code),
  ].join('\n');
}

/**
 * Nội dung comment timeline (readme_design.md mục 5.4). Dòng cuối "Mã" là 8
 * ký tự đầu của webhook_events.uuid, cũng là mã trong log: chỉ để tra log
 * (grep <mã> logs/services/*.log), không dùng để kiểm trùng.
 */
export const timelineBuilder = {
  /** Comment đầy đủ cho một lượt gửi. */
  comment(submission: LeadSubmission, code: string, timezone: string): string {
    const notes = submission.warnings
      .filter((w) => NOTE_CODES.has(w.code))
      .map((w) => w.message);
    return withCode(
      [
        MSG.TIMELINE.HEADER(
          channelLabel(submission.channelKbn),
          submission.campaignName,
          submission.adName,
          submission.formName,
        ),
        MSG.TIMELINE.DETAIL(
          formatLocalDateTime(submission.submittedAt, timezone),
          submission.qualityScore,
          answersText(submission.answers),
        ),
        notes.length
          ? MSG.TIMELINE.NOTES([...new Set(notes)].join('; '))
          : null,
      ],
      code,
    );
  },

  /** Comment ngắn khi form.complete hoàn tất một lượt gửi đã có comment. */
  completion(
    submission: LeadSubmission,
    newAnswers: { question: string; answer: string }[],
    code: string,
  ): string {
    return withCode(
      [
        MSG.TIMELINE.COMPLETION(
          submission.formName,
          submission.qualityScore,
          answersText(newAnswers),
        ),
      ],
      code,
    );
  },

  /** Comment lên deal về lượt gửi tạo ra deal, hoặc lượt gửi được gắn thêm (mục 6.2, bước 6d). */
  deal(submission: LeadSubmission, createdDeal: boolean, code: string): string {
    const header = createdDeal
      ? MSG.TIMELINE.DEAL_CREATED
      : MSG.TIMELINE.DEAL_ATTACHED;
    return withCode(
      [
        header(
          channelLabel(submission.channelKbn),
          submission.campaignName,
          submission.formName,
          submission.qualityScore,
        ),
        answersText(submission.answers) || null,
      ],
      code,
    );
  },
};
