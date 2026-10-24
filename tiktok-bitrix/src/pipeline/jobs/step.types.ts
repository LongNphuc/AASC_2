import type { JsonObject } from '../../database/json';
import type { EntityManager } from 'typeorm';
import type { JobStepKbn, WebhookStatusKbn } from '../../common/kbn/status.kbn';
import type { JobContext } from './job-context';

/** Kết thúc job sớm sau bước này (sự kiện sai, tương tác đã ghi, deal không thuộc ứng dụng…). */
export interface StepFinish {
  statusKbn: WebhookStatusKbn;
  errorKbn?: number;
  errorDetail?: JsonObject;
}

/**
 * Kết quả của một bước. Bước gọi Bitrix24/TikTok trong `run` (gọi ra ngoài
 * trước), rồi trả `commit` ghi kết quả: step-runner chạy `commit` và chuyển
 * current_step_kbn sang bước sau trong CÙNG một transaction (mục 10.5).
 */
export interface StepOutcome {
  commit?: (manager: EntityManager) => Promise<void>;
  /**
   * Việc làm sau khi transaction của bước đã commit (tăng bộ đếm chia sales
   * trong Redis): bước chạy lại hoặc bị từ chối thì không làm. Không được ném
   * lỗi, vì bước đã ghi xong.
   */
  afterCommit?: () => Promise<void>;
  finish?: StepFinish;
}

export interface PipelineStep {
  kbn: JobStepKbn;
  run(ctx: JobContext): Promise<StepOutcome | void>;
}
