import type { BitrixMetadataService } from '../../bitrix/services/bitrix-metadata.service';
import type { BitrixWebhookClient } from '../../bitrix/clients/bitrix-webhook.client';
import { SHEET } from '../../common/constants/messages.constant';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { CooldownRequiredError } from '../../common/http/retry';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { StatusKbn } from '../../common/kbn/status.kbn';
import { BatchKbn, TriggerKbn } from '../../common/kbn/sync.kbn';
import type { AppConfig } from '../../config/app-config';
import type { SheetCell } from '../../google/types/sheets.types';
import { LeadDedupeService } from '../../leads/services/lead-dedupe.service';
import { LeadWriterService } from '../../leads/services/lead-writer.service';
import type { Mapping } from '../../mapping/entities/mapping.entity';
import { withoutFields } from '../../mapping/helpers/ownership';
import { mapRow } from '../../mapping/mappers/row-to-lead.mapper';
import { MappingValidatorService } from '../../mapping/services/mapping-validator.service';
import type { MappingService } from '../../mapping/services/mapping.service';
import { FakeBitrix } from '../../testing/fake-bitrix';
import { cells, HEADERS, MAPPING, METADATA } from '../../testing/fixtures';
import { syncHash } from '../planners/row-hash';
import type { SyncRunRepository } from '../repositories/sync-run.repository';
import type { RunOutcome, RunSummary } from '../types/sync.types';
import type { GoogleTokenRefreshService } from './google-token-refresh.service';
import {
  buildSnapshot,
  SheetReaderService,
  SYSTEM_COLUMNS,
} from './sheet-reader.service';
import type {
  RowWrite,
  SheetWritebackService,
} from './sheet-writeback.service';
import type { SyncLockService } from './sync-lock.service';
import { RunInfo, SyncRunnerService } from './sync-runner.service';

type Row = Record<string, string>;
const rows = (outcome: RunOutcome) => outcome.summary as RunSummary;
const ALL_HEADERS = [...HEADERS, ...SYSTEM_COLUMNS];
const mapping: Mapping = {
  uuid: 'm1',
  version: 1,
  mappingJson: MAPPING,
  createdAt: new Date(),
};
const config = {
  sync: {
    maxRunSeconds: 600,
    heartbeatSeconds: 30,
    pushMaxConsecutiveFailures: 2,
    timezone: 'Asia/Ho_Chi_Minh',
  },
} as AppConfig;

const AN: Row = {
  'Tên khách hàng': 'Nguyễn Văn An',
  Email: 'an@example.com',
  'Số điện thoại': '0901 234 567',
  'Công ty': 'ABC',
  'Trạng thái': 'Chưa giao người xử lý',
};

function snapshotOf(rows: Row[]) {
  const grid: SheetCell[][] = rows.map((r) =>
    ALL_HEADERS.map((h) => ({ text: r[h] ?? '' })),
  );
  return buildSnapshot(1, ALL_HEADERS, grid);
}

function setup(
  rows: Row[],
  overrides: { mapping?: Mapping; config?: AppConfig } = {},
) {
  const bitrix = new FakeBitrix();
  const client = bitrix as unknown as BitrixWebhookClient;
  const lock = {
    acquire: jest.fn().mockResolvedValue({ acquired: true, runUuid: 'r1' }),
    heartbeat: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
    setCooldown: jest.fn().mockResolvedValue(undefined),
  };
  const runs = { finish: jest.fn().mockResolvedValue(undefined) };
  const reader = { read: jest.fn().mockResolvedValue(snapshotOf(rows)) };
  const writeback = {
    write: jest.fn().mockResolvedValue({ cells: 1, notLocated: [] }),
  };
  const metadata = { loadForRun: jest.fn().mockResolvedValue(METADATA) };
  const usedMapping = overrides.mapping ?? mapping;
  const mappings = { latest: jest.fn().mockResolvedValue(usedMapping) };
  const tokenRefresh = {
    run: jest.fn().mockResolvedValue({
      statusKbn: StatusKbn.SUCCESS,
      summary: {
        account_email: 'sa@x',
        expires_at: '2026-10-18T04:00:00.000Z',
      },
      problemRows: null,
    }),
  };
  const runner = new SyncRunnerService(
    lock as unknown as SyncLockService,
    runs as unknown as SyncRunRepository,
    mappings as unknown as MappingService,
    new MappingValidatorService(),
    reader as unknown as SheetReaderService,
    writeback as unknown as SheetWritebackService,
    metadata as unknown as BitrixMetadataService,
    new LeadDedupeService(client),
    new LeadWriterService(client),
    tokenRefresh as unknown as GoogleTokenRefreshService,
    overrides.config ?? config,
  );
  const run: RunInfo = {
    uuid: 'r1-00000000',
    batchKbn: BatchKbn.SHEET_TO_BITRIX,
    trigger: TriggerKbn.MANUAL,
    mapping: usedMapping,
  };
  const writes = () => writeback.write.mock.calls[0]?.[1] as RowWrite[];
  return {
    bitrix,
    lock,
    runs,
    reader,
    writeback,
    metadata,
    mappings,
    tokenRefresh,
    runner,
    run,
    writes,
  };
}

describe('SyncRunnerService', () => {
  it('TC1: hàng mới đủ thông tin → tạo lead, ghi Lead ID, "Đã đồng bộ", thời gian, hash', async () => {
    const t = setup([AN]);
    const outcome = await t.runner.execute(t.run);

    expect(outcome.statusKbn).toBe(StatusKbn.SUCCESS);
    expect(outcome.summary).toEqual({
      total_rows: 1,
      skipped_rows: 0,
      invalid_rows: 0,
      upload_succeeded: { created: 1, updated: 0 },
      upload_failed: 0,
      pending_rows: 0,
    });
    expect(t.bitrix.leads.get(1)).toMatchObject({
      NAME: 'Nguyễn Văn An',
      STATUS_ID: 'NEW',
      PHONE: [{ VALUE: '+84901234567', VALUE_TYPE: 'WORK' }],
    });
    expect(t.writes()[0]).toMatchObject({
      status: SHEET.STATUS.SYNCED,
      leadId: 1,
      syncedAt: true,
      error: null,
    });
    expect(t.runs.finish).toHaveBeenCalledWith(
      'r1-00000000',
      expect.objectContaining({ statusKbn: StatusKbn.SUCCESS }),
    );
    expect(t.lock.release).toHaveBeenCalledWith(
      BatchKbn.SHEET_TO_BITRIX,
      'r1-00000000',
    );
  });

  it('TC2: sửa hàng đã có Lead ID → cập nhật đúng lead, không nhân đôi SĐT, không ghi lại Lead ID', async () => {
    const before = { ...AN, 'Ngân sách dự kiến': '50000000' };
    const oldHash = syncHash(mapRow(cells(before), MAPPING, METADATA).payload);
    const t = setup([
      {
        ...AN,
        'Ngân sách dự kiến': '80000000',
        [SHEET.COLUMNS.LEAD_ID]: '1',
        [SHEET.COLUMNS.SYNC_HASH]: oldHash,
        [SHEET.COLUMNS.SYNC_STATUS]: SHEET.STATUS.SYNCED,
      },
    ]);
    t.bitrix.seed({
      NAME: 'Nguyễn Văn An',
      PHONE: [{ ID: '9', VALUE: '+84901234567' }],
      OPPORTUNITY: 50000000,
    });

    const outcome = await t.runner.execute(t.run);

    expect(rows(outcome).upload_succeeded).toEqual({
      created: 0,
      updated: 1,
    });
    expect(t.bitrix.leads.get(1)).toMatchObject({
      OPPORTUNITY: 80000000,
      PHONE: [{ ID: '9', VALUE: '+84901234567' }],
    });
    expect(t.writes()[0]).toMatchObject({
      status: SHEET.STATUS.SYNCED,
      syncedAt: true,
      leadId: undefined,
    });
  });

  it('TC3: email đã có trên Bitrix24 → cập nhật lead có sẵn, không tạo mới, ghi Lead ID của lead đó', async () => {
    const t = setup([{ ...AN, 'Số điện thoại': '' }]);
    const existing = t.bitrix.seed({
      NAME: 'An (nhập tay)',
      EMAIL: [{ VALUE: 'an@example.com' }],
    });

    const outcome = await t.runner.execute(t.run);

    expect(t.bitrix.leads.size).toBe(1);
    expect(t.bitrix.methods).not.toContain('crm.lead.add');
    expect(rows(outcome).upload_succeeded).toEqual({
      created: 0,
      updated: 1,
    });
    expect(t.writes()[0]).toMatchObject({
      leadId: existing,
      status: SHEET.STATUS.SYNCED,
    });
  });

  it('hai hàng mới cùng SĐT → một lead, cả hai hàng cùng Lead ID', async () => {
    const t = setup([
      AN,
      {
        'Tên khách hàng': 'Nguyễn Văn An',
        'Số điện thoại': '0901234567',
        'Công ty': 'ABC',
      },
    ]);
    await t.runner.execute(t.run);
    expect(t.bitrix.leads.size).toBe(1);
    expect(t.writes().map((w) => w.leadId)).toEqual([1, 1]);
  });

  it('TC4: Bitrix24 quá tải ở batch thứ hai → batch đó chờ, batch khác vẫn xong; lần chạy PARTIAL; problem_rows gom nhóm', async () => {
    const rows: Row[] = Array.from({ length: 120 }, (_, i) => ({
      'Tên khách hàng': `Khách ${String.fromCharCode(65 + (i % 26))}`,
      Email: `k${i}@example.com`,
    }));
    const t = setup(rows);
    const rateLimit = new ExternalApiError(
      'bitrix24',
      'RATE_LIMIT',
      'QUERY_LIMIT_EXCEEDED',
    );
    const passThrough = t.bitrix.callBatch.bind(t.bitrix);
    let call = 0;
    jest
      .spyOn(t.bitrix, 'callBatch')
      .mockImplementation((commands) =>
        ++call === 4 ? Promise.reject(rateLimit) : passThrough(commands),
      );

    const outcome = await t.runner.execute(t.run);

    expect(outcome.statusKbn).toBe(StatusKbn.PARTIAL);
    expect(outcome.summary).toMatchObject({
      total_rows: 120,
      upload_succeeded: { created: 70, updated: 0 },
      pending_rows: 50,
    });
    expect(outcome.problemRows).toHaveLength(1);
    expect(outcome.problemRows![0]).toMatchObject({
      status_kbn: StatusKbn.PENDING,
      error_kbn: 40009,
      message: 'Bitrix24 quá tải, sẽ gửi lại ở lần chạy sau',
    });
    expect(outcome.problemRows![0].rows).toHaveLength(50);
  });

  it('hàng sai dữ liệu: không gửi, ghi "Lỗi" kèm lý do; lần chạy PARTIAL', async () => {
    const t = setup([
      AN,
      { 'Tên khách hàng': 'Võ Minh 2', Email: 'minh@example.com' },
    ]);
    const outcome = await t.runner.execute(t.run);
    expect(outcome.statusKbn).toBe(StatusKbn.PARTIAL);
    expect(rows(outcome).invalid_rows).toBe(1);
    expect(t.writes()[1]).toMatchObject({
      status: SHEET.STATUS.ERROR,
      error: 'Tên khách hàng: không được chứa chữ số',
    });
    expect(outcome.problemRows![0]).toMatchObject({
      status_kbn: StatusKbn.INVALID,
      rows: [{ row: 3, name: 'Võ Minh 2' }],
    });
  });

  it('chạy lại khi không ai sửa gì: không lệnh tạo/cập nhật nào tới Bitrix24', async () => {
    const hash = syncHash(mapRow(cells(AN), MAPPING, METADATA).payload);
    const t = setup([
      {
        ...AN,
        [SHEET.COLUMNS.LEAD_ID]: '1',
        [SHEET.COLUMNS.SYNC_HASH]: hash,
        [SHEET.COLUMNS.SYNC_STATUS]: SHEET.STATUS.SYNCED,
      },
    ]);
    const outcome = await t.runner.execute(t.run);
    expect(t.bitrix.methods).toEqual([]);
    expect(rows(outcome).skipped_rows).toBe(1);
    expect(t.writes()).toEqual([]);
  });

  it('lead không còn trên Bitrix24 → hàng lỗi 40007', async () => {
    const t = setup([{ ...AN, [SHEET.COLUMNS.LEAD_ID]: '99' }]);
    const outcome = await t.runner.execute(t.run);
    expect(rows(outcome).upload_failed).toBe(1);
    expect(outcome.problemRows![0]).toMatchObject({
      error_kbn: 40007,
      rows: [{ row: 2, lead_id: 99 }],
    });
  });

  it('mapping không khớp Sheet → FAILED, không gửi gì, không ghi Sheet', async () => {
    const t = setup([AN]);
    t.reader.read.mockResolvedValue(
      buildSnapshot(1, ['Tên khách hàng', 'Email', ...SYSTEM_COLUMNS], []),
    );
    const outcome = await t.runner.execute(t.run);
    expect(outcome).toMatchObject({
      statusKbn: StatusKbn.FAILED,
      errorKbn: ErrorKbn.HEADER_MISSING,
      summary: null,
    });
    expect(t.writeback.write).not.toHaveBeenCalled();
  });

  it('không đọc được Sheet → FAILED; Google bắt chờ lâu thì ghi cooldown', async () => {
    const t = setup([AN]);
    const retryAt = new Date(Date.now() + 120_000);
    t.reader.read.mockRejectedValue(
      new CooldownRequiredError(
        new ExternalApiError('google-sheets', 'RATE_LIMIT', 'quota'),
        retryAt,
      ),
    );
    const outcome = await t.runner.execute(t.run);
    expect(outcome).toMatchObject({
      statusKbn: StatusKbn.FAILED,
      errorKbn: 30009,
    });
    expect(t.lock.setCooldown).toHaveBeenCalledWith(
      BatchKbn.SHEET_TO_BITRIX,
      'r1-00000000',
      retryAt,
    );
  });

  it('sai webhook khi tra trùng → FAILED, hàng mới "Chờ xử lý" kèm lý do', async () => {
    const t = setup([AN]);
    t.bitrix.failNext.push(
      new ExternalApiError('bitrix24', 'AUTH', 'sai webhook'),
    );
    const outcome = await t.runner.execute(t.run);
    expect(outcome).toMatchObject({
      statusKbn: StatusKbn.FAILED,
      errorKbn: 40003,
    });
    expect(t.writes()[0]).toMatchObject({
      status: SHEET.STATUS.PENDING,
      error: 'sai webhook',
    });
  });

  it('ghi Sheet lỗi → FAILED (lần sau tự bù bằng tra trùng)', async () => {
    const t = setup([AN]);
    t.writeback.write.mockRejectedValue(
      new ExternalApiError('google-sheets', 'SERVER', 'Google lỗi'),
    );
    const outcome = await t.runner.execute(t.run);
    expect(outcome.statusKbn).toBe(StatusKbn.FAILED);
    expect(outcome.errorDetail).toContain('Không ghi được kết quả về Sheet');
  });

  it('lỗi không lường trước vẫn ghi FAILED và trả khóa', async () => {
    const t = setup([AN]);
    t.metadata.loadForRun.mockImplementation(() => {
      throw new TypeError('boom');
    });
    const outcome = await t.runner.execute(t.run);
    expect(outcome).toMatchObject({
      statusKbn: StatusKbn.FAILED,
      errorKbn: ErrorKbn.UNKNOWN,
    });
    expect(t.lock.release).toHaveBeenCalled();
  });

  describe('đồng bộ hai chiều (SYNC_DIRECTION=both, owner: bitrix)', () => {
    const OWNED = new Set(['STATUS_ID', 'ASSIGNED_BY_ID']);
    const owned: Mapping = {
      ...mapping,
      mappingJson: {
        ...MAPPING,
        columns: MAPPING.columns.map((c) =>
          OWNED.has(c.field) ? { ...c, owner: 'bitrix' as const } : c,
        ),
      },
    };
    const both = {
      sync: { ...config.sync, direction: 'both' },
    } as AppConfig;

    it('hàng có lead chỉ đổi Trạng thái → không gửi (Bitrix24 làm chủ); đổi ngân sách → cập nhật không kèm STATUS_ID', async () => {
      const synced = { ...AN, 'Ngân sách dự kiến': '50000000' };
      const hash = syncHash(
        withoutFields(
          mapRow(cells(synced), owned.mappingJson, METADATA).payload,
          OWNED,
        ),
      );
      const done = {
        [SHEET.COLUMNS.SYNC_HASH]: hash,
        [SHEET.COLUMNS.SYNC_STATUS]: SHEET.STATUS.SYNCED,
      };
      const t = setup(
        [
          {
            ...synced,
            ...done,
            'Trạng thái': 'Trong tiến trình',
            [SHEET.COLUMNS.LEAD_ID]: '1',
          },
          {
            ...synced,
            ...done,
            'Ngân sách dự kiến': '80000000',
            [SHEET.COLUMNS.LEAD_ID]: '2',
          },
        ],
        { mapping: owned, config: both },
      );
      t.bitrix.seed({ NAME: 'An', STATUS_ID: 'NEW' });
      t.bitrix.seed({ NAME: 'An', STATUS_ID: 'PROCESSED' });

      const outcome = await t.runner.execute(t.run);

      expect(rows(outcome)).toMatchObject({
        skipped_rows: 1,
        upload_succeeded: { created: 0, updated: 1 },
      });
      expect(t.bitrix.leads.get(1)!.STATUS_ID).toBe('NEW');
      expect(t.bitrix.leads.get(2)).toMatchObject({
        OPPORTUNITY: 80000000,
        STATUS_ID: 'PROCESSED',
      });
    });

    it('hàng mới: vẫn gửi Trạng thái khi tạo lead', async () => {
      const t = setup([AN], { mapping: owned, config: both });
      await t.runner.execute(t.run);
      expect(t.bitrix.leads.get(1)!.STATUS_ID).toBe('NEW');
    });
  });

  describe('batch làm mới token Google', () => {
    it('không cần mapping; chạy việc của batch token, không đụng Sheet hay Bitrix24; trả khóa', async () => {
      const t = setup([AN]);
      t.mappings.latest.mockResolvedValue(null);
      const execute = jest.spyOn(t.runner, 'execute');
      const result = await t.runner.start(
        BatchKbn.GOOGLE_TOKEN_REFRESH,
        TriggerKbn.STARTUP,
      );
      expect(result).toMatchObject({ started: true });
      expect(t.lock.acquire).toHaveBeenCalledWith(
        BatchKbn.GOOGLE_TOKEN_REFRESH,
        TriggerKbn.STARTUP,
        null,
      );
      const outcome = await execute.mock.results[0].value;
      expect(outcome).toMatchObject({
        statusKbn: StatusKbn.SUCCESS,
        summary: { account_email: 'sa@x' },
      });
      expect(t.tokenRefresh.run).toHaveBeenCalled();
      expect(t.reader.read).not.toHaveBeenCalled();
      expect(t.runs.finish).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({ statusKbn: StatusKbn.SUCCESS }),
      );
      expect(t.lock.release).toHaveBeenCalledWith(
        BatchKbn.GOOGLE_TOKEN_REFRESH,
        'r1',
      );
    });
  });

  describe('start', () => {
    it('chưa có mapping → NO_MAPPING; không giành được khóa → LOCKED', async () => {
      const t = setup([]);
      t.mappings.latest.mockResolvedValueOnce(null);
      expect(
        await t.runner.start(BatchKbn.SHEET_TO_BITRIX, TriggerKbn.MANUAL),
      ).toEqual({ started: false, reason: 'NO_MAPPING' });
      t.lock.acquire.mockResolvedValueOnce({
        acquired: false,
        reason: 'NOT_DUE',
      });
      expect(
        await t.runner.start(BatchKbn.SHEET_TO_BITRIX, TriggerKbn.SCHEDULE),
      ).toMatchObject({ started: false, reason: 'LOCKED' });
    });

    it('giành được khóa → trả lời ngay, chạy nền', async () => {
      const t = setup([AN]);
      const execute = jest.spyOn(t.runner, 'execute').mockResolvedValue({
        statusKbn: StatusKbn.SUCCESS,
        summary: null,
        problemRows: null,
      });
      const result = await t.runner.start(
        BatchKbn.SHEET_TO_BITRIX,
        TriggerKbn.MANUAL,
      );
      expect(result).toMatchObject({ started: true, runUuid: 'r1' });
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ uuid: 'r1', mapping }),
      );
      expect(t.lock.acquire).toHaveBeenCalledWith(
        BatchKbn.SHEET_TO_BITRIX,
        TriggerKbn.MANUAL,
        'm1',
      );
    });
  });
});
