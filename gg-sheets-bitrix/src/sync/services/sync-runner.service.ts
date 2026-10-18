import { Inject, Injectable } from '@nestjs/common';
import { BitrixMetadataService } from '../../bitrix/services/bitrix-metadata.service';
import {
  ERROR,
  LOG,
  SHEET,
  WARN,
} from '../../common/constants/messages.constant';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { KbnError } from '../../common/errors/kbn-http.exception';
import { CooldownRequiredError } from '../../common/http/retry';
import { ErrorKbn, errorKbnOf } from '../../common/kbn/error.kbn';
import { StatusKbn } from '../../common/kbn/status.kbn';
import { BatchKbn, TriggerKbn } from '../../common/kbn/sync.kbn';
import { requestContext } from '../../common/logging/request-context';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import {
  buildLeadCommands,
  ExistingLeads,
} from '../../leads/mappers/lead-group.mapper';
import { LeadDedupeService } from '../../leads/services/lead-dedupe.service';
import { LeadWriterService } from '../../leads/services/lead-writer.service';
import type { LeadRowInput, RowAction } from '../../leads/types/lead.types';
import type { Mapping } from '../../mapping/entities/mapping.entity';
import { bitrixOwnedFields } from '../../mapping/helpers/ownership';
import { MappingValidatorService } from '../../mapping/services/mapping-validator.service';
import { MappingService } from '../../mapping/services/mapping.service';
import { planRows, RowPlan } from '../planners/row-planner';
import { SyncRunRepository } from '../repositories/sync-run.repository';
import {
  isRowSummary,
  type AnyRunSummary,
  type ProblemGroup,
  type RunOutcome,
  type RunSummary,
  type SheetSnapshot,
} from '../types/sync.types';
import { GoogleTokenRefreshService } from './google-token-refresh.service';
import { RunControlState } from './run-control';
import { SheetReaderService } from './sheet-reader.service';
import { RowWrite, SheetWritebackService } from './sheet-writeback.service';
import { AcquireResult, SyncLockService } from './sync-lock.service';

export interface RunInfo {
  uuid: string;
  batchKbn: BatchKbn;
  trigger: TriggerKbn;
  /** Mapping dùng cho lần chạy; chỉ batch Sheet → Bitrix24 cần. */
  mapping: Mapping | null;
}

export type StartResult =
  | { started: true; runUuid: string; startedAt: Date }
  | { started: false; reason: 'NO_MAPPING' }
  | {
      started: false;
      reason: 'LOCKED';
      lock: Exclude<AcquireResult, { acquired: true }>;
    };

type ResultKind =
  'SKIP' | 'REFRESH' | 'INVALID' | 'SYNCED' | 'FAILED' | 'PENDING';

interface RowResult {
  plan: RowPlan;
  kind: ResultKind;
  action?: RowAction;
  leadId?: number;
  errorKbn?: number;
  message?: string;
  retryAt?: string;
}

interface Stop {
  error: ExternalApiError | KbnError;
  retryAt?: string;
}

/**
 * Chạy một lần của một batch: giành khóa → làm việc của batch (có nhịp tim) →
 * lưu tổng kết → trả khóa. Hai batch:
 * - GOOGLE_TOKEN_REFRESH: xin access token Google mới, lưu vào google_auth;
 * - SHEET_TO_BITRIX: đọc Sheet → kiểm tra mapping → xét từng hàng (hash) →
 *   tra trùng → gửi Bitrix24 → ghi kết quả về Sheet.
 */
@Injectable()
export class SyncRunnerService {
  private readonly logger = new ServiceLogger(
    LogService.SYNC,
    SyncRunnerService.name,
  );

  constructor(
    private readonly lock: SyncLockService,
    private readonly runs: SyncRunRepository,
    private readonly mappings: MappingService,
    private readonly validator: MappingValidatorService,
    private readonly reader: SheetReaderService,
    private readonly writeback: SheetWritebackService,
    private readonly metadata: BitrixMetadataService,
    private readonly dedupe: LeadDedupeService,
    private readonly writer: LeadWriterService,
    private readonly tokenRefresh: GoogleTokenRefreshService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  /** Giành khóa rồi chạy nền; trả lời ngay (POST /sync/run trả 202). */
  async start(batchKbn: BatchKbn, trigger: TriggerKbn): Promise<StartResult> {
    let mapping: Mapping | null = null;
    if (batchKbn === BatchKbn.SHEET_TO_BITRIX) {
      mapping = await this.mappings.latest();
      if (!mapping) return { started: false, reason: 'NO_MAPPING' };
    }
    const lock = await this.lock.acquire(
      batchKbn,
      trigger,
      mapping?.uuid ?? null,
    );
    if (!lock.acquired) return { started: false, reason: 'LOCKED', lock };
    const startedAt = new Date();
    void this.execute({ uuid: lock.runUuid, batchKbn, trigger, mapping });
    return { started: true, runUuid: lock.runUuid, startedAt };
  }

  /** Chạy một lần đã giành khóa; không ném lỗi (lỗi ghi vào sync_runs). */
  execute(run: RunInfo): Promise<RunOutcome> {
    return requestContext.run(run.uuid.slice(0, 8), async () => {
      const startedAt = Date.now();
      const control = new RunControlState(
        startedAt + this.config.sync.maxRunSeconds * 1000,
        (retryAt) => this.cooldown(run, retryAt),
      );
      const timer = setInterval(
        () => void this.beat(run, control),
        this.config.sync.heartbeatSeconds * 1000,
      );
      timer.unref?.();
      this.logger.record({
        method: LOG.SYNC.RUN_START(
          BatchKbn[run.batchKbn],
          TriggerKbn[run.trigger],
          run.mapping?.version,
        ),
        statusKbn: StatusKbn.PROCESSING,
      });
      let outcome: RunOutcome;
      try {
        outcome =
          run.batchKbn === BatchKbn.GOOGLE_TOKEN_REFRESH
            ? await this.tokenRefresh.run()
            : await this.process(run, control);
      } catch (error) {
        this.logger.error(
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error.stack : undefined,
        );
        outcome = failedOutcome(error);
      } finally {
        clearInterval(timer);
      }
      try {
        await this.runs.finish(run.uuid, outcome);
      } finally {
        if (!control.lockLost) await this.lock.release(run.batchKbn, run.uuid);
      }
      this.logger.record({
        method: LOG.SYNC.RUN_END(describeSummary(outcome.summary)),
        statusKbn: outcome.statusKbn,
        errorKbn: outcome.errorKbn,
        durationMs: Date.now() - startedAt,
        errorDetail: outcome.errorDetail,
      });
      return outcome;
    });
  }

  /** Lần chạy Sheet → Bitrix24. */
  private async process(
    run: RunInfo,
    control: RunControlState,
  ): Promise<RunOutcome> {
    if (!run.mapping) return failedOutcome(new Error(ERROR.SYNC.NO_MAPPING));
    const structure = this.validator.validateStructure(run.mapping.mappingJson);
    if (!structure.config) {
      return failedOutcome(
        new KbnError(
          ErrorKbn.MAPPING_INVALID,
          ERROR.SYNC.MAPPING_INVALID(
            structure.issues.length,
            structure.issues[0].message,
          ),
        ),
      );
    }
    const mapping = structure.config;

    let snapshot: SheetSnapshot;
    let metadata;
    try {
      snapshot = await this.reader.read();
      this.logger.record({
        method: LOG.SYNC.READ(snapshot.rows.length),
        statusKbn: StatusKbn.SUCCESS,
      });
      metadata = await this.metadata.loadForRun(
        mapping.columns.map((c) => c.field),
      );
    } catch (error) {
      return failedOutcome(await this.unwrapCooldown(error, run));
    }
    const issues = this.validator.validateAgainst(
      mapping,
      snapshot.headers,
      metadata,
    );
    if (issues.length > 0) {
      return failedOutcome(
        new KbnError(
          issues[0].errorKbn,
          ERROR.SYNC.MAPPING_INVALID(issues.length, issues[0].message),
        ),
      );
    }

    // Đồng bộ hai chiều: trường do Bitrix24 làm chủ không tính vào hash và chỉ
    // gửi khi tạo lead mới.
    const owned = bitrixOwnedFields(mapping, this.config.sync.direction);
    const plans = planRows(snapshot.rows, mapping, metadata, owned);
    const results = new Map<number, RowResult>();
    for (const plan of plans) {
      if (plan.action === 'INVALID') {
        results.set(plan.row.rowNumber, {
          plan,
          kind: 'INVALID',
          errorKbn: plan.issue!.errorKbn,
          message: plan.issue!.message,
          leadId: plan.leadId,
        });
      } else if (plan.action === 'SKIP') {
        results.set(plan.row.rowNumber, { plan, kind: 'SKIP' });
      } else if (plan.action === 'REFRESH_STATUS') {
        results.set(plan.row.rowNumber, { plan, kind: 'REFRESH' });
      }
    }

    const updatePlans = plans.filter((p) => p.action === 'UPDATE');
    const newPlans = plans.filter((p) => p.action === 'NEW');
    let existing: ExistingLeads = { byEmail: new Map(), byPhone: new Map() };
    let blocked: Stop | null = null;
    let fatal: ExternalApiError | undefined;
    if (newPlans.length > 0) {
      try {
        existing = await this.dedupe.findExisting(
          newPlans.map((p) => p.mapped.email).filter((e): e is string => !!e),
          newPlans.map((p) => p.mapped.phone).filter((p): p is string => !!p),
          control,
        );
      } catch (error) {
        blocked = await this.toStop(error, run);
        if (isFatal(blocked.error)) fatal = blocked.error;
        for (const plan of newPlans)
          results.set(plan.row.rowNumber, pendingResult(plan, blocked));
      }
    }

    const commands = buildLeadCommands(
      updatePlans.map(toInput),
      blocked ? [] : newPlans.map(toInput),
      existing,
      owned,
    );
    const written = await this.writer.write(
      commands,
      control,
      this.config.sync.pushMaxConsecutiveFailures,
    );
    fatal ??= written.fatal;
    const planByRow = new Map(plans.map((p) => [p.row.rowNumber, p]));
    for (const command of commands) {
      const outcome = written.outcomes.get(command.key)!;
      for (const { rowNumber, action } of command.rows) {
        const plan = planByRow.get(rowNumber)!;
        if (outcome.status === 'success') {
          results.set(rowNumber, {
            plan,
            kind: 'SYNCED',
            action,
            leadId: outcome.leadId,
          });
          if (action === 'LINK')
            this.logDuplicate(plan, outcome.leadId, existing);
        } else if (outcome.status === 'failed') {
          results.set(rowNumber, {
            plan,
            kind: 'FAILED',
            errorKbn: errorKbnOf(outcome.error),
            message: outcome.error.message,
            leadId: command.target ?? undefined,
          });
        } else {
          results.set(rowNumber, pendingResult(plan, outcome));
        }
      }
    }

    const ordered = plans.map((p) => results.get(p.row.rowNumber)!);
    for (const result of ordered) this.logRowProblem(result);

    let writebackError: unknown;
    if (!control.lockLost) {
      try {
        const done = await this.writeback.write(
          snapshot,
          ordered.map(toRowWrite).filter((w): w is RowWrite => !!w),
        );
        this.logger.record({
          method: LOG.SYNC.WRITEBACK(done.cells),
          statusKbn: StatusKbn.SUCCESS,
        });
        for (const row of done.notLocated) {
          this.logger.warn(WARN.SYNC.ROW_NOT_LOCATED(row));
          this.logger.record({
            method: `row ${row}`,
            statusKbn: StatusKbn.FAILED,
            errorKbn: ErrorKbn.ROW_NOT_LOCATED,
            errorDetail: WARN.SYNC.ROW_NOT_LOCATED(row),
          });
        }
      } catch (error) {
        writebackError = await this.unwrapCooldown(error, run);
      }
    }

    const summary = summarize(ordered);
    const problemRows = groupProblems(ordered);
    const base = { summary, problemRows };
    if (control.lockLost)
      return {
        ...base,
        statusKbn: StatusKbn.FAILED,
        errorKbn: ErrorKbn.LOCK_LOST,
        errorDetail: ERROR.SYNC.LOCK_LOST,
      };
    if (fatal)
      return {
        ...base,
        statusKbn: StatusKbn.FAILED,
        errorKbn: errorKbnOf(fatal),
        errorDetail: fatal.message,
      };
    if (writebackError) {
      const message =
        writebackError instanceof Error
          ? writebackError.message
          : JSON.stringify(writebackError);
      return {
        ...base,
        statusKbn: StatusKbn.FAILED,
        errorKbn: errorKbnOf(writebackError),
        errorDetail: ERROR.SYNC.WRITEBACK_FAILED(message),
      };
    }
    return {
      ...base,
      statusKbn: problemRows.length > 0 ? StatusKbn.PARTIAL : StatusKbn.SUCCESS,
    };
  }

  private async beat(run: RunInfo, control: RunControlState): Promise<void> {
    const alive = await this.lock
      .heartbeat(run.batchKbn, run.uuid)
      .catch(() => true);
    if (!alive && !control.lockLost) {
      control.lockLost = true;
      this.logger.warn(WARN.SYNC.LOCK_LOST(run.uuid));
    }
  }

  private async cooldown(run: RunInfo, retryAt: Date): Promise<void> {
    await this.lock.setCooldown(run.batchKbn, run.uuid, retryAt);
    this.logger.warn(WARN.SYNC.COOLDOWN(retryAt.toISOString()));
  }

  /** API báo phải chờ lâu: ghi cooldown, trả lỗi gốc để báo lý do. */
  private async unwrapCooldown(error: unknown, run: RunInfo): Promise<unknown> {
    if (error instanceof CooldownRequiredError) {
      await this.cooldown(run, error.retryAt);
      return error.error;
    }
    return error;
  }

  private async toStop(error: unknown, run: RunInfo): Promise<Stop> {
    if (error instanceof CooldownRequiredError) {
      await this.cooldown(run, error.retryAt);
      return { error: error.error, retryAt: error.retryAt.toISOString() };
    }
    if (error instanceof ExternalApiError || error instanceof KbnError)
      return { error };
    throw error;
  }

  private logDuplicate(
    plan: RowPlan,
    leadId: number,
    existing: ExistingLeads,
  ): void {
    const byEmail =
      plan.mapped.email && existing.byEmail.get(plan.mapped.email) === leadId;
    const byPhone =
      plan.mapped.phone && existing.byPhone.get(plan.mapped.phone) === leadId;
    const key = byEmail ? 'email' : byPhone ? 'phone' : 'group';
    this.logger.record({
      method: LOG.SYNC.DUPLICATE(plan.row.rowNumber, leadId, key),
      statusKbn: StatusKbn.SUCCESS,
    });
  }

  private logRowProblem(result: RowResult): void {
    const statusKbn = PROBLEM_STATUS[result.kind];
    if (statusKbn === undefined) return;
    this.logger.record({
      method: `row ${result.plan.row.rowNumber}`,
      statusKbn,
      errorKbn: result.errorKbn,
      errorDetail: result.message,
    });
  }
}

const PROBLEM_STATUS: Partial<Record<ResultKind, StatusKbn>> = {
  INVALID: StatusKbn.INVALID,
  FAILED: StatusKbn.FAILED,
  PENDING: StatusKbn.PENDING,
};

function toInput(plan: RowPlan): LeadRowInput {
  return {
    rowNumber: plan.row.rowNumber,
    payload: plan.mapped.payload,
    email: plan.mapped.email,
    phone: plan.mapped.phone,
    leadId: plan.leadId,
  };
}

function isFatal(error: unknown): error is ExternalApiError {
  return (
    error instanceof ExternalApiError &&
    (error.kind === 'AUTH' || error.kind === 'CONFIG')
  );
}

/** Lý do hiển thị cho hàng chưa gửi được. */
export function pendingMessage(error: ExternalApiError | KbnError): string {
  if (error instanceof ExternalApiError) {
    if (error.kind === 'RATE_LIMIT') return ERROR.SYNC.RATE_LIMITED;
    if (error.kind === 'OPERATION_LIMIT') return ERROR.SYNC.OPERATION_LIMITED;
    if (['TIMEOUT', 'NETWORK', 'SERVER'].includes(error.kind))
      return ERROR.SYNC.NOT_SENT;
  }
  return error.message;
}

function pendingResult(plan: RowPlan, stop: Stop): RowResult {
  return {
    plan,
    kind: 'PENDING',
    errorKbn: errorKbnOf(stop.error),
    message: pendingMessage(stop.error),
    retryAt: stop.retryAt,
    leadId: plan.leadId,
  };
}

/** Những ô cần ghi lên Sheet cho một hàng (bảng trong readme_design mục 6). */
export function toRowWrite(result: RowResult): RowWrite | null {
  const row = result.plan.row;
  switch (result.kind) {
    case 'SKIP':
      return null;
    case 'REFRESH':
      return { row, status: SHEET.STATUS.SYNCED, error: null };
    case 'SYNCED':
      return {
        row,
        status: SHEET.STATUS.SYNCED,
        syncedAt: true,
        error: null,
        hash: result.plan.hash,
        leadId: result.action === 'UPDATE' ? undefined : result.leadId,
      };
    default: {
      const status =
        result.kind === 'PENDING' ? SHEET.STATUS.PENDING : SHEET.STATUS.ERROR;
      if (row.syncStatus === status && row.errorText === result.message)
        return null;
      return { row, status, error: result.message ?? '' };
    }
  }
}

/** Mỗi hàng kết thúc ở đúng một kết quả, nên các số cộng lại bằng total_rows. */
export function summarize(results: RowResult[]): RunSummary {
  const count = (predicate: (r: RowResult) => boolean) =>
    results.filter(predicate).length;
  return {
    total_rows: results.length,
    skipped_rows: count((r) => r.kind === 'SKIP' || r.kind === 'REFRESH'),
    invalid_rows: count((r) => r.kind === 'INVALID'),
    upload_succeeded: {
      created: count((r) => r.kind === 'SYNCED' && r.action === 'CREATE'),
      updated: count((r) => r.kind === 'SYNCED' && r.action !== 'CREATE'),
    },
    upload_failed: count((r) => r.kind === 'FAILED'),
    pending_rows: count((r) => r.kind === 'PENDING'),
  };
}

/** Gom hàng có vấn đề theo (status_kbn, error_kbn, message, retry_after). */
export function groupProblems(results: RowResult[]): ProblemGroup[] {
  const groups = new Map<string, ProblemGroup>();
  for (const result of results) {
    const statusKbn = PROBLEM_STATUS[result.kind];
    if (statusKbn === undefined) continue;
    const errorKbn = result.errorKbn ?? ErrorKbn.UNKNOWN;
    const message = result.message ?? '';
    const key = [statusKbn, errorKbn, message, result.retryAt ?? ''].join('|');
    const group = groups.get(key) ?? {
      status_kbn: statusKbn,
      error_kbn: errorKbn,
      message,
      ...(result.retryAt ? { retry_after: result.retryAt } : {}),
      rows: [],
    };
    group.rows.push({
      row: result.plan.row.rowNumber,
      name: result.plan.mapped.name,
      ...(result.leadId ? { lead_id: result.leadId } : {}),
    });
    groups.set(key, group);
  }
  return [...groups.values()];
}

function failedOutcome(error: unknown): RunOutcome {
  return {
    statusKbn: StatusKbn.FAILED,
    errorKbn: errorKbnOf(error),
    errorDetail: error instanceof Error ? error.message : String(error),
    summary: null,
    problemRows: null,
  };
}

function describeSummary(summary: AnyRunSummary | null): string {
  if (!summary) return '-';
  if (!isRowSummary(summary)) {
    return `token ${summary.account_email ?? '-'} hết hạn lúc ${summary.expires_at}`;
  }
  return [
    `total ${summary.total_rows}`,
    `skipped ${summary.skipped_rows}`,
    `invalid ${summary.invalid_rows}`,
    `created ${summary.upload_succeeded.created}`,
    `updated ${summary.upload_succeeded.updated}`,
    `upload_failed ${summary.upload_failed}`,
    `pending ${summary.pending_rows}`,
  ].join(', ');
}
