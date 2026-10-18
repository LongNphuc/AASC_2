/**
 * Mã trạng thái (status_kbn), dùng chung cho DB, log và response.
 * Bắt đầu bằng 1 để không trùng với mã lỗi (error_kbn bắt đầu từ 2).
 */
export enum StatusKbn {
  SUCCESS = 10000,
  FAILED = 10001,
  PROCESSING = 10002,
  /** Hàng không đổi so với lần trước; chỉ đếm, không ghi chi tiết. */
  SKIPPED = 10003,
  /** Lần chạy xong nhưng có hàng lỗi hoặc chờ. */
  PARTIAL = 10004,
  /** Hàng chưa gửi được (quá tải, hết giờ), lần sau gửi lại. */
  PENDING = 10005,
  /** Hàng sai dữ liệu, không gửi. */
  INVALID = 10006,
}
