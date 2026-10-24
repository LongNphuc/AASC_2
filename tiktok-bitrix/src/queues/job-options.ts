import type { JobsOptions } from 'bullmq';
import { SourceKbn } from '../common/kbn/type.kbn';
import { JOB, type PipelineJobName } from './queue-names';

/** Ưu tiên của job từ import: BullMQ chạy job không đặt priority trước (mục 10.1). */
export const IMPORT_PRIORITY = 10;

const DAY_SECONDS = 86_400;

/** Phần của dòng webhook_events cần để dựng job. */
export interface PipelineEventRef {
  uuid: string;
  providerKbn: number;
  eventId: string;
}

/** Loại job theo nơi gửi sự kiện. */
export function jobNameFor(event: PipelineEventRef): PipelineJobName {
  switch (event.providerKbn) {
    case SourceKbn.BITRIX24:
      return JOB.BITRIX_DEAL_EVENT;
    case SourceKbn.MANUAL:
      return JOB.CONVERT_DEAL;
    default:
      return JOB.TIKTOK_EVENT;
  }
}

/**
 * jobId gắn với dòng webhook_events (hoặc deal sinh sẵn của yêu cầu chuyển
 * tay): đẩy trùng thì BullMQ bỏ qua (readme_design.md mục 3.4).
 */
export function jobIdFor(event: PipelineEventRef): string {
  switch (event.providerKbn) {
    case SourceKbn.BITRIX24:
      return `bx-${event.uuid}`;
    case SourceKbn.MANUAL:
      return `convert-${event.eventId}`;
    default:
      return `evt-${event.uuid}`;
  }
}

/**
 * Thử lại cả job 2, 4, 8 giây (attempts 4); job xong giữ 1 ngày, job lỗi
 * (dead letter queue) giữ 7 ngày.
 */
export function pipelineJobOptions(
  event: PipelineEventRef,
  attempts: number,
  backoffMs: number,
): JobsOptions {
  return {
    jobId: jobIdFor(event),
    attempts,
    backoff: { type: 'exponential', delay: backoffMs },
    removeOnComplete: { age: DAY_SECONDS },
    removeOnFail: { age: 7 * DAY_SECONDS },
    ...(event.providerKbn === SourceKbn.IMPORT
      ? { priority: IMPORT_PRIORITY }
      : {}),
  };
}
