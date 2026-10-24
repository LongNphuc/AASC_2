/** Tên queue và tên job (readme_design.md mục 10.1). */
export const QUEUE = {
  /** Mọi việc ghi dữ liệu nghiệp vụ, chạy lần lượt từng job một. */
  CRM_PIPELINE: 'crm-pipeline',
  /** Job định kỳ: recovery, daily-report, alert-check. */
  MAINTENANCE: 'maintenance',
} as const;

export const JOB = {
  TIKTOK_EVENT: 'tiktok-event',
  BITRIX_DEAL_EVENT: 'bitrix-deal-event',
  CONVERT_DEAL: 'convert-deal',
  RECOVERY: 'recovery',
  DAILY_REPORT: 'daily-report',
  ALERT_CHECK: 'alert-check',
} as const;

export type PipelineJobName =
  | typeof JOB.TIKTOK_EVENT
  | typeof JOB.BITRIX_DEAL_EVENT
  | typeof JOB.CONVERT_DEAL;

/** Job chỉ mang ID; dữ liệu đọc từ DB lúc chạy, nên chạy lại luôn thấy trạng thái mới nhất. */
export interface PipelineJobData {
  webhookEventUuid: string;
}

/** Job của queue maintenance; `manual` khi chạy tay qua API. */
export interface MaintenanceJobData {
  manual?: boolean;
  /** recovery chạy lại đúng một sự kiện (POST /api/v1/ops/recovery/run?webhook_event_uuid=…). */
  webhookEventUuid?: string;
}
