import type { BitrixWebhookClient } from '../../bitrix/clients/bitrix-webhook.client';
import type { BitrixMetadataService } from '../../bitrix/services/bitrix-metadata.service';
import { SHEET } from '../../common/constants/messages.constant';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import type { SheetCell } from '../../google/types/sheets.types';
import type { Mapping } from '../../mapping/entities/mapping.entity';
import { MappingValidatorService } from '../../mapping/services/mapping-validator.service';
import type { MappingService } from '../../mapping/services/mapping.service';
import type { MappingConfig } from '../../mapping/types/mapping.types';
import { FakeBitrix } from '../../testing/fake-bitrix';
import { HEADERS, MAPPING, METADATA } from '../../testing/fixtures';
import { BitrixToSheetService } from './bitrix-to-sheet.service';
import {
  buildSnapshot,
  SheetReaderService,
  SYSTEM_COLUMNS,
} from './sheet-reader.service';
import type { SheetWritebackService } from './sheet-writeback.service';

type Row = Record<string, string>;
const ALL_HEADERS = [...HEADERS, ...SYSTEM_COLUMNS];
const OWNED = ['STATUS_ID', 'ASSIGNED_BY_ID'];

/** mapping.json của dự án: trạng thái và người phụ trách do Bitrix24 làm chủ. */
const OWNED_MAPPING: MappingConfig = {
  ...MAPPING,
  columns: MAPPING.columns.map((c) =>
    OWNED.includes(c.field) ? { ...c, owner: 'bitrix' as const } : c,
  ),
};

const row = (leadId: string, values: Row): Row => ({
  'Tên khách hàng': 'Nguyễn Văn An',
  Email: 'an@example.com',
  [SHEET.COLUMNS.LEAD_ID]: leadId,
  ...values,
});

function setup(rows: Row[], mappingJson: MappingConfig | null = OWNED_MAPPING) {
  const bitrix = new FakeBitrix();
  const grid: SheetCell[][] = rows.map((r) =>
    ALL_HEADERS.map((h) => ({ text: r[h] ?? '' })),
  );
  const reader = {
    read: jest.fn().mockResolvedValue(buildSnapshot(1, ALL_HEADERS, grid)),
  };
  const writeback = {
    write: jest.fn().mockResolvedValue({ cells: 2, notLocated: [] }),
  };
  const mapping: Mapping | null = mappingJson
    ? { uuid: 'm1', version: 1, mappingJson, createdAt: new Date() }
    : null;
  const mappings = { latest: jest.fn().mockResolvedValue(mapping) };
  const metadata = { loadForRun: jest.fn().mockResolvedValue(METADATA) };
  const service = new BitrixToSheetService(
    mappings as unknown as MappingService,
    new MappingValidatorService(),
    reader as unknown as SheetReaderService,
    writeback as unknown as SheetWritebackService,
    metadata as unknown as BitrixMetadataService,
    bitrix as unknown as BitrixWebhookClient,
  );
  return { bitrix, reader, writeback, service };
}

describe('BitrixToSheetService.syncLead', () => {
  it('sales đổi giai đoạn trên CRM → ghi đúng ô Trạng thái của mọi hàng có Lead ID đó; ô đã khớp thì không ghi', async () => {
    const t = setup([
      row('1', {
        'Trạng thái': 'Chưa giao người xử lý',
        'Người phụ trách': 'long@example.com',
      }),
      row('2', { 'Trạng thái': 'Chưa giao người xử lý' }),
      row('1', {
        'Trạng thái': 'Trong tiến trình',
        'Người phụ trách': 'Long Nguyen Phuc',
      }),
    ]);
    t.bitrix.seed({ STATUS_ID: 'IN_PROCESS', ASSIGNED_BY_ID: '1' });

    const result = await t.service.syncLead(1);

    expect(result).toEqual({
      leadId: 1,
      rows: 2,
      updatedRows: [2],
      changes: [
        "row 2: Trạng thái 'Chưa giao người xử lý' → 'Trong tiến trình'",
      ],
      notLocated: [],
    });
    const [, writes] = t.writeback.write.mock.calls[0] as [unknown, unknown[]];
    expect(writes).toEqual([
      expect.objectContaining({
        cells: { 'Trạng thái': 'Trong tiến trình' },
        syncedAt: true,
      }),
    ]);
    expect(t.bitrix.methods).toEqual(['crm.lead.get']);
  });

  it('người phụ trách đổi trên CRM → ghi họ tên; không đụng Lead ID, hash, trạng thái đồng bộ', async () => {
    const t = setup([
      row('1', { 'Trạng thái': 'Trong tiến trình', 'Người phụ trách': '' }),
    ]);
    t.bitrix.seed({ STATUS_ID: 'IN_PROCESS', ASSIGNED_BY_ID: '1' });
    await t.service.syncLead(1);
    const [, writes] = t.writeback.write.mock.calls[0] as [
      unknown,
      Record<string, unknown>[],
    ];
    expect(Object.keys(writes[0]).sort()).toEqual(['cells', 'row', 'syncedAt']);
    expect(writes[0].cells).toEqual({ 'Người phụ trách': 'Long Nguyen Phuc' });
  });

  it('lead không có trên Sheet (không do Sheet tạo) → không ghi gì', async () => {
    const t = setup([row('2', { 'Trạng thái': 'Chưa giao người xử lý' })]);
    t.bitrix.seed({ STATUS_ID: 'NEW' });
    expect(await t.service.syncLead(1)).toMatchObject({
      rows: 0,
      updatedRows: [],
    });
    expect(t.writeback.write).toHaveBeenCalledWith(expect.anything(), []);
  });

  it('hàng bị xóa/sửa trong lúc ghi → báo notLocated', async () => {
    const t = setup([row('1', { 'Trạng thái': 'Chưa giao người xử lý' })]);
    t.bitrix.seed({ STATUS_ID: 'IN_PROCESS' });
    t.writeback.write.mockResolvedValue({ cells: 0, notLocated: [2] });
    expect(await t.service.syncLead(1)).toMatchObject({
      updatedRows: [],
      notLocated: [2],
    });
  });

  it('mapping không có cột owner: bitrix, hoặc chưa có mapping → 422, không gọi Bitrix24', async () => {
    const plain = setup([], MAPPING);
    await expect(plain.service.syncLead(1)).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('owner'),
    });
    const none = setup([], null);
    await expect(none.service.syncLead(1)).rejects.toBeInstanceOf(
      KbnHttpException,
    );
    expect(plain.bitrix.methods).toEqual([]);
  });

  it('lead không còn trên Bitrix24 → lỗi NOT_FOUND, không đọc Sheet', async () => {
    const t = setup([row('1', {})]);
    await expect(t.service.syncLead(9)).rejects.toBeInstanceOf(
      ExternalApiError,
    );
    expect(t.reader.read).not.toHaveBeenCalled();
  });
});
