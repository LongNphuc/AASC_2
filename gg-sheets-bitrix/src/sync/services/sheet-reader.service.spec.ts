import type { AppConfig } from '../../config/app-config';
import type { SheetsClient } from '../../google/clients/sheets.client';
import { ExternalApiError } from '../../common/errors/external-api.error';
import {
  buildSnapshot,
  SheetReaderService,
  SYSTEM_COLUMNS,
} from './sheet-reader.service';

const config = {
  google: { spreadsheetId: 'sid', sheetName: 'Leads' },
} as AppConfig;
const t = (text: string) => ({ text });

describe('buildSnapshot', () => {
  it('bù ô trống cuối hàng, bỏ hàng trống, đọc giá trị 5 cột kết quả', () => {
    const headers = ['Tên', 'Email', ...SYSTEM_COLUMNS];
    const snapshot = buildSnapshot(7, headers, [
      [t('An'), t('a@b.vn')],
      [],
      [t(''), t('')],
      [
        t('Bình'),
        t('b@b.vn'),
        t('Đã đồng bộ'),
        t('98'),
        t('2026-10-15 10:00:00'),
        t(''),
        t('9f2c'),
      ],
    ]);
    expect(snapshot.rows.map((r) => r.rowNumber)).toEqual([2, 5]);
    expect(snapshot.rows[0].cells.get('Email')).toEqual(t('a@b.vn'));
    expect(snapshot.rows[0].leadIdText).toBe('');
    expect(snapshot.rows[1]).toMatchObject({
      leadIdText: '98',
      syncHash: '9f2c',
      syncStatus: 'Đã đồng bộ',
    });
    expect(snapshot.columnIndex.get('Sync Hash')).toBe(6);
  });

  it('dấu vân tay chỉ tính cột dữ liệu: ghi kết quả không làm đổi dấu vân tay', () => {
    const headers = ['Tên', ...SYSTEM_COLUMNS];
    const [before] = buildSnapshot(1, headers, [[t('An')]]).rows;
    const [after] = buildSnapshot(1, headers, [
      [t('An'), t('Đã đồng bộ'), t('5')],
    ]).rows;
    expect(after.fingerprint).toBe(before.fingerprint);
  });
});

describe('SheetReaderService.read', () => {
  it('Sheet chưa có cột kết quả: thêm cột vào cuối, ghi tiêu đề, ẩn Lead ID và Sync Hash', async () => {
    const sheets = {
      assertTab: jest.fn().mockResolvedValue({
        sheetId: 7,
        title: 'Leads',
        rowCount: 100,
        columnCount: 3,
      }),
      readGrid: jest.fn().mockResolvedValue([
        [t('Tên'), t('Email'), t('')],
        [t('An'), t('a@b.vn')],
      ]),
      batchUpdate: jest.fn().mockResolvedValue(undefined),
      updateValues: jest.fn().mockResolvedValue(5),
    };
    const reader = new SheetReaderService(
      sheets as unknown as SheetsClient,
      config,
    );

    const snapshot = await reader.read();

    expect(sheets.batchUpdate.mock.calls[0][1]).toEqual([
      { appendDimension: { sheetId: 7, dimension: 'COLUMNS', length: 4 } },
    ]);
    expect(sheets.updateValues).toHaveBeenCalledWith('sid', [
      { range: "'Leads'!C1:G1", values: [[...SYSTEM_COLUMNS]] },
    ]);
    const hidden = (
      sheets.batchUpdate.mock.calls[1][1] as {
        updateDimensionProperties: { range: { startIndex: number } };
      }[]
    ).map((r) => r.updateDimensionProperties.range.startIndex);
    expect(hidden).toEqual([3, 6]);
    expect(snapshot.headers).toEqual(['Tên', 'Email', ...SYSTEM_COLUMNS]);
    expect(snapshot.rows).toHaveLength(1);
  });

  it('đã đủ cột kết quả thì không sửa Sheet', async () => {
    const sheets = {
      assertTab: jest.fn().mockResolvedValue({
        sheetId: 7,
        title: 'Leads',
        rowCount: 100,
        columnCount: 26,
      }),
      readGrid: jest
        .fn()
        .mockResolvedValue([[t('Tên'), ...SYSTEM_COLUMNS.map(t)]]),
      batchUpdate: jest.fn(),
      updateValues: jest.fn(),
    };
    const reader = new SheetReaderService(
      sheets as unknown as SheetsClient,
      config,
    );
    await reader.read();
    expect(sheets.batchUpdate).not.toHaveBeenCalled();
    expect(sheets.updateValues).not.toHaveBeenCalled();
  });

  it('không có tab thì ném lỗi của assertTab; thiếu cấu hình thì báo tên biến', async () => {
    const sheets = {
      assertTab: jest
        .fn()
        .mockRejectedValue(
          new ExternalApiError(
            'google-sheets',
            'SHEET_NOT_FOUND',
            'Không tìm thấy tab',
          ),
        ),
    };
    await expect(
      new SheetReaderService(sheets as unknown as SheetsClient, config).read(),
    ).rejects.toThrow('Không tìm thấy tab');
    const empty = { google: {} } as AppConfig;
    await expect(
      new SheetReaderService(sheets as unknown as SheetsClient, empty).read(),
    ).rejects.toThrow('GOOGLE_SPREADSHEET_ID');
  });

  it('đọc lại Sheet trước khi ghi', async () => {
    const sheets = {
      readGrid: jest.fn().mockResolvedValue([[t('Tên')], [t('An')]]),
    };
    const snapshot = await new SheetReaderService(
      sheets as unknown as SheetsClient,
      config,
    ).reread(7);
    expect(snapshot.rows).toHaveLength(1);
  });
});
