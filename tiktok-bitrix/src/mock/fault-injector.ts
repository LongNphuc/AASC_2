import { Injectable } from '@nestjs/common';

/** Loại lỗi giả (readme_api.md mục 9). */
export type FaultKind =
  | 'QUERY_LIMIT_EXCEEDED'
  | 'OPERATION_TIME_LIMIT'
  | '500'
  | 'timeout'
  | 'ACCESS_DENIED'
  | 'delay';

export interface Fault {
  service: 'bitrix24' | 'tiktok';
  error: FaultKind;
  /** Còn áp cho bao nhiêu lệnh nữa. */
  count: number;
  /** Chỉ lỗi ở method này (kể cả khi nằm trong batch). */
  method?: string;
  /** Với crm.item.*: chỉ lỗi với deal (2) hoặc Contact (3). */
  entityTypeId?: number;
  /** Với timeout: thực hiện xong lệnh rồi mới treo. */
  after?: boolean;
  /** Với delay: giữ phản hồi bao nhiêu mili giây. */
  ms?: number;
}

/**
 * Giả lỗi cho N lệnh tới để thử các tình huống lỗi (E8–E36): Bitrix24 quá
 * tải, lỗi máy chủ, timeout, sai quyền. Mỗi lần áp thì giảm count; hết count
 * thì bỏ.
 */
@Injectable()
export class FaultInjector {
  private faults: Fault[] = [];

  add(fault: Partial<Fault>): Fault {
    const normalized: Fault = {
      service: fault.service === 'tiktok' ? 'tiktok' : 'bitrix24',
      error: fault.error ?? '500',
      count: Number(fault.count ?? 1),
      method: fault.method,
      entityTypeId:
        fault.entityTypeId !== undefined
          ? Number(fault.entityTypeId)
          : undefined,
      after: fault.after === true,
      ms: fault.ms !== undefined ? Number(fault.ms) : undefined,
    };
    this.faults.push(normalized);
    return normalized;
  }

  clear(): void {
    this.faults = [];
  }

  list(): Fault[] {
    return this.faults;
  }

  /**
   * Lấy (và tiêu một lượt) lỗi áp cho một lệnh. `method` undefined khi xét cả
   * request (lỗi không ghi method áp cho request đầu tiên tới).
   */
  take(
    service: Fault['service'],
    method: string | undefined,
    params: Record<string, unknown> = {},
  ): Fault | undefined {
    const index = this.faults.findIndex(
      (f) =>
        f.service === service &&
        f.count > 0 &&
        (method === undefined ? !f.method : f.method === method) &&
        (f.entityTypeId === undefined ||
          Number(params.entityTypeId) === f.entityTypeId),
    );
    if (index < 0) return undefined;
    const fault = this.faults[index];
    fault.count -= 1;
    if (fault.count <= 0) this.faults.splice(index, 1);
    return fault;
  }
}
