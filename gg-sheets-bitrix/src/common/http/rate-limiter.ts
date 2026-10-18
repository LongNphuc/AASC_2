import { sleep as realSleep } from './sleep';

/**
 * Giữ nhịp tối đa N request mỗi giây: mỗi lần acquire() lấy một "chỗ" cách
 * chỗ trước 1000/N ms; chưa tới chỗ của mình thì chờ. Dùng cho Bitrix24
 * (khoảng 2 request/giây) để không bị chặn ngay từ đầu.
 */
export class RateLimiter {
  private nextSlot = 0;

  constructor(
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
  ) {}

  async acquire(): Promise<void> {
    const interval = 1000 / this.perSecond;
    const now = this.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + interval;
    if (slot > now) {
      await this.sleep(slot - now);
    }
  }
}
