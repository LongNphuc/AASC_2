import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { appConfig, type AppConfig } from '../../config/app-config';
import { LeadSubmission } from '../entities/lead-submission.entity';

/**
 * form.complete là bước hoàn tất của chính lượt gửi trước đó (readme_design.md
 * mục 4.4): tìm lượt gửi của khách cùng form_id, gửi trong
 * FORM_COMPLETE_WINDOW_HOURS trước đó, chưa có completed_at.
 */
@Injectable()
export class FormCompletionService {
  constructor(@Inject(appConfig.KEY) private readonly config: AppConfig) {}

  async findOpenSubmission(
    manager: EntityManager,
    leadUuid: string,
    formId: string | undefined,
    completedAt: Date,
  ): Promise<LeadSubmission | null> {
    if (!formId) return null;
    const windowStart = new Date(
      completedAt.getTime() -
        this.config.tiktok.formCompleteWindowHours * 3_600_000,
    );
    return manager
      .getRepository(LeadSubmission)
      .createQueryBuilder('s')
      .where('s.lead_uuid = :leadUuid', { leadUuid })
      .andWhere('s.form_id = :formId', { formId })
      .andWhere('s.completed_at IS NULL')
      .andWhere('s.submitted_at BETWEEN :windowStart AND :completedAt', {
        windowStart,
        completedAt,
      })
      .orderBy('s.submitted_at', 'DESC')
      .getOne();
  }
}
