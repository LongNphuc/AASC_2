import { Injectable } from '@nestjs/common';
import { logFiles } from '../common/logging/log-files';

export interface MockCall {
  at: string;
  service: 'bitrix24' | 'tiktok';
  method: string;
  params?: unknown;
  body?: unknown;
  ok: boolean;
  result?: unknown;
  error?: string;
}

const MAX_CALLS = 5000;

/**
 * Ghi mọi lệnh gọi mock nhận được (đề: "Log tất cả API calls để verify
 * integration"): trong bộ nhớ cho GET /_mock/calls, và vào logs/mock-calls.log.
 */
@Injectable()
export class CallLogService {
  private calls: MockCall[] = [];

  record(call: Omit<MockCall, 'at'>): void {
    const entry = { at: new Date().toISOString(), ...call };
    this.calls.unshift(entry);
    if (this.calls.length > MAX_CALLS) this.calls.length = MAX_CALLS;
    logFiles.write(
      'mock-calls.log',
      `${entry.at} | ${entry.service} | ${entry.method} | ${entry.ok ? 'OK' : `ERROR ${entry.error}`} | ${JSON.stringify(call.params ?? call.body ?? {})}`,
    );
  }

  /** Mới nhất trước; lọc theo dịch vụ và method. */
  list(service?: string, method?: string): MockCall[] {
    return this.calls.filter(
      (c) =>
        (!service || c.service === service) && (!method || c.method === method),
    );
  }

  clear(): void {
    this.calls = [];
  }
}
