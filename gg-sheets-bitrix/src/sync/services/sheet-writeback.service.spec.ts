import type { AppConfig } from '../../config/app-config';
import type { SheetsClient } from '../../google/clients/sheets.client';
import type { SheetRow, SheetSnapshot } from '../types/sync.types';
import { SYSTEM_COLUMNS } from './sheet-reader.service';
import { locateRows, SheetWritebackService } from './sheet-writeback.service';
import type { SheetReaderService } from './sheet-reader.service';

const headers = ['Tên', ...SYSTEM_COLUMNS];
const columnIndex = new Map(headers.map((h, i) => [h, i] as const));
const config = {
  google: { spreadsheetId: 'sid', sheetName: 'Leads' },
  sync: { timezone: 'Asia/Ho_Chi_Minh' },
} as AppConfig;

function sheetRow(rowNumber: number, fingerprint: string): SheetRow {
  return {
    rowNumber,
    cells: new Map(),
    leadIdText: '',
    syncHash: '',
    syncStatus: '',
    errorText: '',
    fingerprint,
  };
}
function snapshot(rows: SheetRow[]): SheetSnapshot {
  return { sheetId: 1, headers, columnIndex, rows };
}

describe('locateRows', () => {
  it('hàng còn ở chỗ cũ thì ghi đúng chỗ; hàng bị đẩy xuống thì tìm theo dấu vân tay; hàng mất thì báo', () => {
    const current = snapshot([
      sheetRow(2, 'new'),
      sheetRow(3, 'A'),
      sheetRow(4, 'B'),
    ]);
    const writes = [
      { row: sheetRow(2, 'A') },
      { row: sheetRow(4, 'B') },
      { row: sheetRow(5, 'C') },
    ];
    const { found, notLocated } = locateRows(current, writes);
    expect(found.map((f) => [f.write.row.rowNumber, f.rowNumber])).toEqual([
      [4, 4],
      [2, 3],
    ]);
    expect(notLocated).toEqual([5]);
  });

  it('hai hàng giống hệt nhau thì mỗi hàng nhận một vị trí', () => {
    const current = snapshot([sheetRow(2, 'X'), sheetRow(3, 'X')]);
    const { found } = locateRows(current, [
      { row: sheetRow(2, 'X') },
      { row: sheetRow(3, 'X') },
    ]);
    expect(found.map((f) => f.rowNumber)).toEqual([2, 3]);
  });
});

describe('SheetWritebackService.write', () => {
  it('ghi các ô theo bảng ghi kết quả trong một lệnh', async () => {
    const reader = {
      reread: jest
        .fn()
        .mockResolvedValue(snapshot([sheetRow(2, 'A'), sheetRow(3, 'B')])),
    };
    const sheets = { updateValues: jest.fn().mockResolvedValue(7) };
    const service = new SheetWritebackService(
      reader as unknown as SheetReaderService,
      sheets as unknown as SheetsClient,
      config,
    );

    const result = await service.write(
      snapshot([]),
      [
        {
          row: sheetRow(2, 'A'),
          status: 'Đã đồng bộ',
          leadId: 123,
          syncedAt: true,
          error: null,
          hash: 'h1',
        },
        {
          row: sheetRow(3, 'B'),
          status: 'Lỗi',
          error: 'Email: email không hợp lệ',
        },
      ],
      new Date('2026-10-15T03:00:00Z'),
    );

    expect(result).toEqual({ cells: 7, notLocated: [] });
    expect(sheets.updateValues).toHaveBeenCalledWith('sid', [
      { range: "'Leads'!B2", values: [['Đã đồng bộ']] },
      { range: "'Leads'!C2", values: [[123]] },
      { range: "'Leads'!D2", values: [['2026-10-15 10:00:00']] },
      { range: "'Leads'!E2", values: [['']] },
      { range: "'Leads'!F2", values: [['h1']] },
      { range: "'Leads'!B3", values: [['Lỗi']] },
      { range: "'Leads'!E3", values: [['Email: email không hợp lệ']] },
    ]);
  });

  it('ghi ô dữ liệu theo tên cột (giá trị lấy từ Bitrix24 về)', async () => {
    const reader = {
      reread: jest.fn().mockResolvedValue(snapshot([sheetRow(2, 'A')])),
    };
    const sheets = { updateValues: jest.fn().mockResolvedValue(2) };
    const service = new SheetWritebackService(
      reader as unknown as SheetReaderService,
      sheets as unknown as SheetsClient,
      config,
    );
    await service.write(
      snapshot([]),
      [{ row: sheetRow(2, 'A'), cells: { Tên: 'Mới' }, syncedAt: true }],
      new Date('2026-10-15T03:00:00Z'),
    );
    expect(sheets.updateValues).toHaveBeenCalledWith('sid', [
      { range: "'Leads'!D2", values: [['2026-10-15 10:00:00']] },
      { range: "'Leads'!A2", values: [['Mới']] },
    ]);
  });

  it('không có gì để ghi thì không gọi Google', async () => {
    const reader = { reread: jest.fn() };
    const service = new SheetWritebackService(
      reader as unknown as SheetReaderService,
      {} as SheetsClient,
      config,
    );
    await expect(service.write(snapshot([]), [])).resolves.toEqual({
      cells: 0,
      notLocated: [],
    });
    expect(reader.reread).not.toHaveBeenCalled();
  });
});
