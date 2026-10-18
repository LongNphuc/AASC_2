import { Injectable } from '@nestjs/common';
import {
  BATCH_LIMIT,
  BitrixWebhookClient,
} from '../../bitrix/clients/bitrix-webhook.client';
import type {
  BatchCommand,
  BitrixMultiField,
} from '../../bitrix/types/bitrix.types';
import { ERROR, LOG } from '../../common/constants/messages.constant';
import { ExternalApiError } from '../../common/errors/external-api.error';
import type { KbnError } from '../../common/errors/kbn-http.exception';
import { CooldownRequiredError } from '../../common/http/retry';
import { errorKbnOf } from '../../common/kbn/error.kbn';
import { StatusKbn } from '../../common/kbn/status.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { newMultiValues } from '../mappers/multifield.mapper';
import type {
  CommandOutcome,
  LeadCommand,
  RunControl,
} from '../types/lead.types';

interface Chunk {
  commands: LeadCommand[];
  create: boolean;
}

interface StopState {
  error: ExternalApiError | KbnError;
  retryAt?: string;
}

export interface WriteResult {
  outcomes: Map<string, CommandOutcome>;
  /** Lỗi hệ thống (sai webhook, thiếu cấu hình) khiến phải dừng cả lần chạy. */
  fatal?: ExternalApiError;
}

/** Lệnh tạo lead chỉ thử lại khi bị từ chối vì quá tải (Bitrix24 chưa xử lý). */
const retryCreateOnlyOnRateLimit = (error: unknown) =>
  error instanceof ExternalApiError && error.kind === 'RATE_LIMIT';

/**
 * Gửi lệnh tạo/cập nhật lead theo batch 50 lệnh: tạo trước, cập nhật sau.
 * - Mỗi lệnh có kết quả riêng; lệnh bị từ chối chỉ làm hàng của nó lỗi.
 * - Một batch thử đủ lần vẫn lỗi: hàng của batch đó chờ, gửi tiếp batch sau (TC4);
 *   N batch liên tiếp lỗi thì dừng, phần còn lại chờ.
 * - Batch có lệnh tạo bị timeout/mất mạng: không thử lại (không biết Bitrix24 đã
 *   tạo lead chưa); lần sau bước tra trùng sẽ tìm thấy lead nếu đã tạo.
 * - API báo phải chờ lâu: ghi cooldown, phần còn lại chờ.
 */
@Injectable()
export class LeadWriterService {
  private readonly logger = new ServiceLogger(
    LogService.SYNC,
    LeadWriterService.name,
  );

  constructor(private readonly bitrix: BitrixWebhookClient) {}

  async write(
    commands: LeadCommand[],
    control: RunControl,
    maxConsecutiveFailures: number,
  ): Promise<WriteResult> {
    const outcomes = new Map<string, CommandOutcome>();
    const state: { stop: StopState | null; fatal?: ExternalApiError } = {
      stop: null,
    };

    const updates = commands.filter((c) => c.target !== null);
    await this.dropKnownMultiValues(updates, outcomes, control, state);

    const remaining = updates.filter((c) => !outcomes.has(c.key));
    const chunks: Chunk[] = [
      ...split(commands.filter((c) => c.target === null)).map((cmds) => ({
        commands: cmds,
        create: true,
      })),
      ...split(remaining).map((cmds) => ({ commands: cmds, create: false })),
    ];

    let consecutiveFailures = 0;
    for (const [index, chunk] of chunks.entries()) {
      const reason = state.stop ?? stopFrom(control);
      if (reason) {
        markPending(chunk.commands, reason, outcomes);
        continue;
      }
      const startedAt = Date.now();
      const label = LOG.SYNC.PUSH_BATCH(
        index + 1,
        chunks.length,
        chunk.commands.length,
      );
      try {
        const results = await this.bitrix.callBatch(toBatch(chunk), {
          isRetryable: chunk.create ? retryCreateOnlyOnRateLimit : undefined,
          canWait: (ms) => control.canWait(ms),
        });
        consecutiveFailures = 0;
        for (const command of chunk.commands) {
          const result = results[command.key];
          outcomes.set(
            command.key,
            result.ok
              ? {
                  status: 'success',
                  leadId: command.target ?? Number(result.result),
                }
              : {
                  status: 'failed',
                  error: rejected(result.error, command.target),
                },
          );
        }
        this.logger.record({
          method: label,
          statusKbn: StatusKbn.SUCCESS,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        if (error instanceof CooldownRequiredError) {
          await control.onCooldown(error.retryAt);
          state.stop = {
            error: error.error,
            retryAt: error.retryAt.toISOString(),
          };
          markPending(chunk.commands, state.stop, outcomes);
          this.logChunkFailure(label, error.error, startedAt);
          continue;
        }
        if (!(error instanceof ExternalApiError)) throw error;
        markPending(chunk.commands, { error }, outcomes);
        this.logChunkFailure(label, error, startedAt);
        if (error.kind === 'AUTH' || error.kind === 'CONFIG') {
          state.fatal = error;
          state.stop = { error };
          continue;
        }
        consecutiveFailures++;
        if (consecutiveFailures >= maxConsecutiveFailures)
          state.stop = { error };
      }
    }
    return { outcomes, fatal: state.fatal };
  }

  /**
   * Bitrix24 hiểu PHONE/EMAIL trong crm.lead.update là thêm giá trị mới: đọc
   * giá trị hiện có của các lead cần cập nhật (crm.lead.get, 50 lead một batch)
   * và bỏ giá trị lead đã có. Lead không còn tồn tại thì báo lỗi, không cập nhật.
   */
  private async dropKnownMultiValues(
    updates: LeadCommand[],
    outcomes: Map<string, CommandOutcome>,
    control: RunControl,
    state: { stop: StopState | null; fatal?: ExternalApiError },
  ): Promise<void> {
    const withMulti = updates.filter((c) => multiFields(c.payload).length > 0);
    for (const cmds of split(withMulti)) {
      const reason = state.stop ?? stopFrom(control);
      if (reason) {
        markPending(cmds, reason, outcomes);
        continue;
      }
      try {
        const batch = Object.fromEntries(
          cmds.map((c): [string, BatchCommand] => [
            c.key,
            { method: 'crm.lead.get', params: { id: c.target } },
          ]),
        );
        const results = await this.bitrix.callBatch<
          Record<string, BitrixMultiField[] | undefined>
        >(batch, {
          canWait: (ms) => control.canWait(ms),
        });
        for (const command of cmds) {
          const result = results[command.key];
          if (!result.ok) {
            outcomes.set(command.key, {
              status: 'failed',
              error: rejected(result.error, command.target),
            });
            continue;
          }
          for (const field of multiFields(command.payload)) {
            const fresh = newMultiValues(
              field,
              result.result[field],
              command.payload[field] as BitrixMultiField[],
            );
            if (fresh.length) command.payload[field] = fresh;
            else delete command.payload[field];
          }
        }
      } catch (error) {
        if (error instanceof CooldownRequiredError) {
          await control.onCooldown(error.retryAt);
          state.stop = {
            error: error.error,
            retryAt: error.retryAt.toISOString(),
          };
          markPending(cmds, state.stop, outcomes);
          continue;
        }
        if (!(error instanceof ExternalApiError)) throw error;
        markPending(cmds, { error }, outcomes);
        if (error.kind === 'AUTH' || error.kind === 'CONFIG') {
          state.fatal = error;
          state.stop = { error };
        }
      }
    }
  }

  private logChunkFailure(
    label: string,
    error: ExternalApiError,
    startedAt: number,
  ): void {
    this.logger.record({
      method: label,
      statusKbn: StatusKbn.FAILED,
      errorKbn: errorKbnOf(error),
      durationMs: Date.now() - startedAt,
      errorDetail: error.message,
    });
  }
}

function split<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH_LIMIT)
    chunks.push(items.slice(i, i + BATCH_LIMIT));
  return chunks;
}

function stopFrom(control: RunControl): StopState | null {
  const error = control.stopReason();
  return error ? { error } : null;
}

function markPending(
  commands: LeadCommand[],
  reason: StopState,
  outcomes: Map<string, CommandOutcome>,
): void {
  for (const command of commands) {
    if (!outcomes.has(command.key)) {
      outcomes.set(command.key, {
        status: 'pending',
        error: reason.error,
        retryAt: reason.retryAt,
      });
    }
  }
}

function toBatch(chunk: Chunk): Record<string, BatchCommand> {
  return Object.fromEntries(
    chunk.commands.map((c): [string, BatchCommand] => [
      c.key,
      c.target === null
        ? { method: 'crm.lead.add', params: { fields: c.payload } }
        : {
            method: 'crm.lead.update',
            params: { id: c.target, fields: c.payload },
          },
    ]),
  );
}

function multiFields(payload: Record<string, unknown>): string[] {
  return Object.entries(payload)
    .filter(
      ([, v]) =>
        Array.isArray(v) &&
        v.length > 0 &&
        v.every((x) => !!x && typeof x === 'object' && 'VALUE' in x),
    )
    .map(([k]) => k);
}

function rejected(
  error: ExternalApiError,
  target: number | null,
): ExternalApiError {
  const message =
    error.kind === 'NOT_FOUND' && target !== null
      ? ERROR.SYNC.LEAD_NOT_FOUND(target)
      : ERROR.SYNC.REJECTED(error.details.upstreamMessage || error.message);
  return new ExternalApiError(
    error.service,
    error.kind,
    message,
    error.details,
  );
}
