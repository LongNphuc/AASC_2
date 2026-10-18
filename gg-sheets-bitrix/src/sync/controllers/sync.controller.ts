import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { API_DOC, ERROR } from '../../common/constants/messages.constant';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { StatusKbn } from '../../common/kbn/status.kbn';
import {
  BatchKbn,
  BatchStatusKbn,
  TriggerKbn,
} from '../../common/kbn/sync.kbn';
import { appConfig, type AppConfig } from '../../config/app-config';
import { ListRunsQuery } from '../dto/list-runs.query';
import { RunBatchQuery } from '../dto/run-batch.query';
import { nextRunAt } from '../helpers/schedule';
import { SyncBatchRepository } from '../repositories/sync-batch.repository';
import {
  RunWithMapping,
  SyncRunRepository,
} from '../repositories/sync-run.repository';
import { SyncRunnerService } from '../services/sync-runner.service';

@ApiTags(API_DOC.SYNC.TAG)
@ApiSecurity('api-key')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly runner: SyncRunnerService,
    private readonly batches: SyncBatchRepository,
    private readonly runs: SyncRunRepository,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: API_DOC.SYNC.RUN })
  async run(@Query() query: RunBatchQuery = {}) {
    const batchName = query.batch ?? 'SHEET_TO_BITRIX';
    const result = await this.runner.start(
      BatchKbn[batchName],
      TriggerKbn.MANUAL,
    );
    if (result.started) {
      return {
        runUuid: result.runUuid,
        status: StatusKbn[StatusKbn.PROCESSING],
        statusKbn: StatusKbn.PROCESSING,
        startedAt: result.startedAt,
      };
    }
    if (result.reason === 'NO_MAPPING') {
      throw new KbnHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorKbn.MAPPING_INVALID,
        ERROR.LABEL.MAPPING_INVALID,
        ERROR.SYNC.NO_MAPPING,
      );
    }
    const { lock } = result;
    if (lock.reason === 'BUSY') {
      throw new KbnHttpException(
        HttpStatus.CONFLICT,
        ErrorKbn.BUSY,
        ERROR.LABEL.SYNC_BUSY,
        ERROR.SYNC.BUSY(
          lock.startedAt?.toISOString() ?? '-',
          lock.heartbeatAt?.toISOString() ?? '-',
        ),
        { runUuid: lock.runUuid },
      );
    }
    if (lock.reason === 'COOLDOWN') {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((lock.cooldownUntil.getTime() - Date.now()) / 1000),
      );
      throw new KbnHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorKbn.COOLDOWN,
        ERROR.LABEL.SYNC_COOLDOWN,
        ERROR.SYNC.COOLDOWN(lock.cooldownUntil.toISOString()),
        { cooldownUntil: lock.cooldownUntil, retryAfterSeconds },
      );
    }
    throw new KbnHttpException(
      HttpStatus.NOT_FOUND,
      ErrorKbn.NOT_FOUND,
      'NOT_FOUND',
      ERROR.SYNC.BATCH_NOT_FOUND(batchName),
    );
  }

  @Get('batches')
  @ApiOperation({ summary: API_DOC.SYNC.BATCHES })
  async listBatches() {
    const staleMs = this.config.sync.staleSeconds * 1000;
    const now = Date.now();
    return (await this.batches.findAll()).map((b) => {
      const running = b.batchStatusKbn === BatchStatusKbn.RUNNING;
      return {
        batch: BatchKbn[b.batchKbn],
        name: b.name,
        intervalSeconds: b.intervalSeconds,
        status: BatchStatusKbn[b.batchStatusKbn],
        runUuid: b.runUuid,
        startedAt: b.startedAt,
        finishedAt: b.finishedAt,
        heartbeatAt: b.heartbeatAt,
        stale:
          running && !!b.heartbeatAt && now - b.heartbeatAt.getTime() > staleMs,
        cooldownUntil:
          b.cooldownUntil && b.cooldownUntil.getTime() > now
            ? b.cooldownUntil
            : null,
        nextRunAt: running ? null : nextRunAt(b.finishedAt, b.intervalSeconds),
      };
    });
  }

  @Get('runs')
  @ApiOperation({ summary: API_DOC.SYNC.RUNS })
  async listRuns(@Query() query: ListRunsQuery) {
    const batchKbn = BatchKbn[query.batch ?? 'SHEET_TO_BITRIX'];
    const runs = await this.runs.list(batchKbn, query.limit ?? 20);
    return runs.map((run) => toRunView(run, false));
  }

  @Get('runs/:uuid')
  @ApiOperation({ summary: API_DOC.SYNC.RUN_DETAIL })
  async runDetail(@Param('uuid', ParseUUIDPipe) uuid: string) {
    const run = await this.runs.findOne(uuid);
    if (!run) {
      throw new KbnHttpException(
        HttpStatus.NOT_FOUND,
        ErrorKbn.NOT_FOUND,
        'NOT_FOUND',
        ERROR.SYNC.RUN_NOT_FOUND(uuid),
      );
    }
    return toRunView(run, true);
  }
}

function toRunView(run: RunWithMapping, withProblems: boolean) {
  return {
    uuid: run.uuid,
    batch: BatchKbn[run.batchKbn],
    trigger: TriggerKbn[run.triggerKbn],
    status: StatusKbn[run.statusKbn],
    statusKbn: run.statusKbn,
    errorKbn: run.errorKbn,
    errorDetail: run.errorDetail,
    mappingVersion: run.mappingVersion,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    summary: run.summary,
    ...(withProblems ? { problem_rows: run.problemRows ?? [] } : {}),
  };
}
