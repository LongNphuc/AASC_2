/**
 * Mã trạng thái (*_kbn), dùng chung cho DB, log và response
 * (readme_design.md mục 12.1). Bắt đầu bằng 1 để không trùng với mã lỗi
 * (error_kbn bắt đầu từ 2).
 */

/** Kết quả chung: sync_status_kbn của lượt gửi, status_kbn của conversion, thông báo, import. */
export enum StatusKbn {
  SUCCESS = 10000,
  FAILED = 10001,
  PROCESSING = 10002,
  PENDING = 10005,
}

/** webhook_events.status_kbn. */
export enum WebhookStatusKbn {
  RECEIVED = 11001,
  PROCESSED = 11002,
  IGNORED = 11003,
  INVALID = 11004,
  FAILED = 11005,
}

/**
 * Bước của job (webhook_events.current_step_kbn, readme_design.md mục 10.5).
 * Thứ tự khai báo không quan trọng: thứ tự chạy nằm ở pipeline/jobs/.
 */
export enum JobStepKbn {
  CHECK_EVENT = 11101,
  SUBMISSION = 11102,
  LEAD_SYNC = 11103,
  CONTACT_SYNC = 11104,
  TIMELINE = 11105,
  RULE = 11106,
  CONTACT = 11107,
  DEAL = 11108,
  LEAD_CONVERTED = 11109,
  DEAL_COMMENT = 11110,
  NOTIFY = 11111,
  CONVERSION = 11112,
  BX_DEAL_SYNC = 11121,
  BX_PROBABILITY = 11122,
  CONVERT_CHECK = 11131,
}

/** Ký hiệu bước trong tài liệu (6c, 3a…), để log dễ đối chiếu với readme_design.md. */
export const JOB_STEP_LABEL: Partial<Record<number, string>> = {
  [JobStepKbn.CHECK_EVENT]: '1',
  [JobStepKbn.SUBMISSION]: '2',
  [JobStepKbn.LEAD_SYNC]: '3a',
  [JobStepKbn.CONTACT_SYNC]: '3b',
  [JobStepKbn.TIMELINE]: '4',
  [JobStepKbn.RULE]: '5',
  [JobStepKbn.CONTACT]: '6a',
  [JobStepKbn.DEAL]: '6b',
  [JobStepKbn.LEAD_CONVERTED]: '6c',
  [JobStepKbn.DEAL_COMMENT]: '6d',
  [JobStepKbn.NOTIFY]: '7a',
  [JobStepKbn.CONVERSION]: '7b',
  [JobStepKbn.BX_DEAL_SYNC]: 'bx1',
  [JobStepKbn.BX_PROBABILITY]: 'bx2',
  [JobStepKbn.CONVERT_CHECK]: 'm1',
};

/** leads.status_kbn. */
export enum LeadStatusKbn {
  /** Chưa lên CRM. */
  NEW = 15001,
  IN_CRM = 15002,
  /** Có deal, lead trên Bitrix24 đã CONVERTED. */
  CONVERTED = 15003,
}

/** deals.status_kbn. */
export enum DealStatusKbn {
  OPEN = 16001,
  WON = 16002,
  LOST = 16003,
  DELETED = 16004,
}
