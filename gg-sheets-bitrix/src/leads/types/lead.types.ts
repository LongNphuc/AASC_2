import type { ExternalApiError } from '../../common/errors/external-api.error';
import type { KbnError } from '../../common/errors/kbn-http.exception';

/** Một hàng cần gửi lên Bitrix24 (đã đổi giá trị theo mapping). */
export interface LeadRowInput {
  rowNumber: number;
  payload: Record<string, unknown>;
  email?: string;
  phone?: string;
  /** Lead ID đã có trên hàng (hàng UPDATE); không có là hàng mới. */
  leadId?: number;
}

/** Hành động với một hàng khi gửi thành công. */
export type RowAction = 'CREATE' | 'UPDATE' | 'LINK';

/** Một lệnh gửi lên Bitrix24: một lead đích, có thể gộp từ nhiều hàng. */
export interface LeadCommand {
  key: string;
  /** Lead đích; null là tạo lead mới. */
  target: number | null;
  payload: Record<string, unknown>;
  rows: { rowNumber: number; action: RowAction }[];
}

export type CommandOutcome =
  | { status: 'success'; leadId: number }
  | { status: 'failed'; error: ExternalApiError | KbnError }
  | { status: 'pending'; error: ExternalApiError | KbnError; retryAt?: string };

/** Lần chạy cho phép gửi tiếp không (hết giờ, mất khóa), và báo cooldown. */
export interface RunControl {
  /** Lý do phải dừng gửi, hoặc null nếu còn gửi được. */
  stopReason(): KbnError | null;
  /** Chờ thêm `ms` có vượt thời gian tối đa của lần chạy không. */
  canWait(ms: number): boolean;
  /** API báo phải chờ tới `retryAt`: ghi cooldown_until. */
  onCooldown(retryAt: Date): Promise<void>;
}
