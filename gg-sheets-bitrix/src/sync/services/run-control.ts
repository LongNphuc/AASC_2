import { ERROR } from '../../common/constants/messages.constant';
import { KbnError } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import type { RunControl } from '../../leads/types/lead.types';

/**
 * Trạng thái điều khiển của một lần chạy: đã quá thời gian tối đa chưa, còn
 * giữ khóa không. Giờ chỉ được kiểm tra giữa các batch (không cắt ngang lệnh
 * đang chạy), nên hàng đã gửi thành công luôn được ghi kết quả về Sheet.
 */
export class RunControlState implements RunControl {
  lockLost = false;

  constructor(
    private readonly deadline: number,
    private readonly cooldown: (retryAt: Date) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  stopReason(): KbnError | null {
    if (this.lockLost)
      return new KbnError(ErrorKbn.LOCK_LOST, ERROR.SYNC.LOCK_LOST);
    if (this.now() >= this.deadline)
      return new KbnError(ErrorKbn.DEADLINE, ERROR.SYNC.DEADLINE);
    return null;
  }

  canWait(ms: number): boolean {
    return this.now() + ms < this.deadline;
  }

  onCooldown(retryAt: Date): Promise<void> {
    return this.cooldown(retryAt);
  }
}
