import { Inject, Injectable } from '@nestjs/common';
import { Bitrix24Client } from '../../bitrix/clients/bitrix24.client';
import { MSG } from '../../common/constants/messages.constant';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { LeadStatusKbn, StatusKbn } from '../../common/kbn/status.kbn';
import { EventTypeKbn } from '../../common/kbn/type.kbn';
import { logCode } from '../../common/logging/job-context';
import { appConfig, type AppConfig } from '../../config/app-config';
import {
  LeadSubmission,
  type SubmissionWarning,
} from '../../leads/entities/lead-submission.entity';
import {
  LeadEventNormalizer,
  warning,
  WARNING,
} from '../../leads/services/lead-event-normalizer.service';
import type { JobContext } from '../../pipeline/jobs/job-context';
import type { StepOutcome } from '../../pipeline/jobs/step.types';
import { timelineBuilder } from './timeline.builder';

/** Đích của một comment timeline. */
export interface CommentTarget {
  entityType: 'lead' | 'contact' | 'deal';
  entityId: number;
}

export type CommentResult =
  { ok: true } | { ok: false; warning: SubmissionWarning };

/**
 * Gửi một comment timeline. Bitrix24 từ chối (sai quyền, dữ liệu, bản ghi
 * không còn): trả cảnh báo, job vẫn đi tiếp, vì comment chỉ là lịch sử. Lỗi
 * tạm thời (quá tải, timeout): ném ra để job thử lại (mục 5.4).
 */
export async function postComment(
  bitrix: Bitrix24Client,
  target: CommentTarget,
  comment: string,
): Promise<CommentResult> {
  try {
    await bitrix.call('crm.timeline.comment.add', {
      fields: {
        ENTITY_ID: target.entityId,
        ENTITY_TYPE: target.entityType,
        COMMENT: comment,
      },
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ExternalApiError && !error.transient) {
      return {
        ok: false,
        warning: warning(
          WARNING.COMMENT_REJECTED,
          MSG.WARNING.COMMENT_REJECTED(
            `${target.entityType} #${target.entityId}`,
            error.message,
          ),
        ),
      };
    }
    throw error;
  }
}

/**
 * Bước 4 của job tiktok-event (readme_design.md mục 5.4). Comment hay không do
 * DB quyết định, theo câu hỏi "lượt gửi này đã có comment chưa":
 *
 *   timeline_posted_at trống                    → comment đầy đủ
 *   có, sự kiện form.complete, chưa có comment hoàn tất → comment ngắn
 *   còn lại                                     → không comment
 *
 * Ghi lên lead; khách đã CONVERTED và có Contact thì ghi lên Contact. Xong bước
 * 3–4 thì lượt gửi SUCCESS ("đã đồng bộ").
 */
@Injectable()
export class TimelineService {
  constructor(
    private readonly bitrix: Bitrix24Client,
    private readonly normalizer: LeadEventNormalizer,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async post(ctx: JobContext): Promise<StepOutcome> {
    const submission = await ctx.requireSubmission();
    const lead = await ctx.lead(submission.leadUuid);
    const isCompletion = ctx.event.eventTypeKbn === EventTypeKbn.FORM_COMPLETE;
    const code = logCode(ctx.event.uuid);
    const target: CommentTarget | null =
      lead.statusKbn === LeadStatusKbn.CONVERTED && lead.bitrixContactId
        ? { entityType: 'contact', entityId: lead.bitrixContactId }
        : lead.bitrix24Id
          ? { entityType: 'lead', entityId: lead.bitrix24Id }
          : null;

    let comment: string | null = null;
    const posted: Partial<LeadSubmission> = {};
    const now = new Date();
    if (!submission.timelinePostedAt) {
      comment = timelineBuilder.comment(submission, code, this.config.timezone);
      posted.timelinePostedAt = now;
      if (isCompletion) posted.completionPostedAt = now;
    } else if (isCompletion && !submission.completionPostedAt) {
      comment = timelineBuilder.completion(
        submission,
        this.newAnswers(ctx),
        code,
      );
      posted.completionPostedAt = now;
    }

    const warnings: SubmissionWarning[] = [];
    let saved: Partial<LeadSubmission> = {};
    if (comment && target) {
      const result = await postComment(this.bitrix, target, comment);
      if (result.ok) saved = posted;
      else warnings.push(result.warning);
    }

    return {
      commit: async (manager) => {
        await manager.update(
          LeadSubmission,
          { uuid: submission.uuid },
          {
            ...saved,
            ...(warnings.length
              ? { warnings: [...submission.warnings, ...warnings] }
              : {}),
            syncStatusKbn: StatusKbn.SUCCESS,
            syncedAt: now,
            errorKbn: null,
            errorDetail: null,
            updatedAt: now,
          },
        );
      },
    };
  }

  /** Câu trả lời trong chính sự kiện form.complete đang xử lý. */
  private newAnswers(ctx: JobContext): { question: string; answer: string }[] {
    const result = this.normalizer.normalizeLead(ctx.event);
    return result.ok ? result.value.custom_questions : [];
  }
}
