/** Trạng thái khóa của một batch (sync_batches.batch_status_kbn). */
export enum BatchStatusKbn {
  DONE = 11000,
  RUNNING = 11001,
}

/** Ai kích hoạt lần chạy (sync_runs.trigger_kbn). */
export enum TriggerKbn {
  /** Looper chạy theo lịch. */
  SCHEDULE = 13001,
  /** Bấm chạy (POST /sync/run). */
  MANUAL = 13002,
  /** Ứng dụng vừa khởi động mà chưa có token Google dùng được: làm mới ngay. */
  STARTUP = 13003,
}

/** Loại batch (sync_batches.batch_kbn). */
export enum BatchKbn {
  SHEET_TO_BITRIX = 14001,
  /** Lấy access token Google mới, lưu vào bảng google_auth. */
  GOOGLE_TOKEN_REFRESH = 14002,
}
