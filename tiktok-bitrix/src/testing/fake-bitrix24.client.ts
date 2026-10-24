import type { Bitrix24Client } from '../bitrix/clients/bitrix24.client';
import { fromErrorBody } from '../bitrix/mappers/bitrix-error.mapper';
import type { BatchCommand, BatchResult } from '../bitrix/types/bitrix.types';
import {
  BitrixMockMethods,
  MockBitrixError,
} from '../mock/bitrix/bitrix-mock.methods';
import { BitrixMockStore } from '../mock/bitrix/bitrix-mock.store';

/** Lỗi giả cho lệnh tới: theo tên method, áp `times` lần. */
interface ScriptedFault {
  method: string;
  error: { status: number; error: string; error_description?: string };
  times: number;
}

/**
 * Bitrix24Client giả cho unit test: chạy thẳng trên store của mock (cùng hành
 * vi với process mock), ghi lại lệnh gọi, giả lỗi theo kịch bản.
 */
export class FakeBitrix24Client {
  readonly store = new BitrixMockStore();
  readonly methods = new BitrixMockMethods(this.store);
  readonly calls: { method: string; params: Record<string, unknown> }[] = [];
  private faults: ScriptedFault[] = [];

  fail(method: string, error: ScriptedFault['error'], times = 1): this {
    this.faults.push({ method, error, times });
    return this;
  }

  call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const result = this.run(method, params);
    return result.ok
      ? Promise.resolve(result.result as T)
      : Promise.reject(result.error);
  }

  callBatch<T = unknown>(
    commands: Record<string, BatchCommand>,
  ): Promise<Record<string, BatchResult<T>>> {
    this.calls.push({
      method: 'batch',
      params: { commands: Object.keys(commands) },
    });
    return Promise.resolve(
      Object.fromEntries(
        Object.entries(commands).map(([key, command]) => [
          key,
          this.run(command.method, command.params) as BatchResult<T>,
        ]),
      ),
    );
  }

  /** Số lệnh đã gọi tới một method (không tính lệnh nằm trong batch). */
  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  asClient(): Bitrix24Client {
    return this as unknown as Bitrix24Client;
  }

  private run(method: string, params: Record<string, unknown>): BatchResult {
    this.calls.push({ method, params });
    const fault = this.faults.find((f) => f.method === method && f.times > 0);
    if (fault) {
      fault.times--;
      return {
        ok: false,
        error: fromErrorBody(fault.error.status, fault.error, method),
      };
    }
    try {
      // Như gọi qua HTTP: tham số đi qua JSON.
      return {
        ok: true,
        result: this.methods.execute(
          method,
          JSON.parse(JSON.stringify(params)) as Record<string, unknown>,
        ),
      };
    } catch (error) {
      if (error instanceof MockBitrixError) {
        return {
          ok: false,
          error: fromErrorBody(
            error.status,
            { error: error.code, error_description: error.description },
            method,
          ),
        };
      }
      throw error;
    }
  }
}
