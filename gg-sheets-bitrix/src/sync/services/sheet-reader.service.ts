import { Inject, Injectable } from '@nestjs/common';
import { LOG, SHEET } from '../../common/constants/messages.constant';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import { SheetsClient } from '../../google/clients/sheets.client';
import { columnLetter, quoteSheetName } from '../../google/helpers/a1-notation';
import { requireSheetConfig } from '../../google/helpers/sheet-config';
import type { SheetCell, SheetTab } from '../../google/types/sheets.types';
import { contentFingerprint } from '../planners/row-hash';
import type { SheetRow, SheetSnapshot } from '../types/sync.types';

/** 5 cột kết quả theo thứ tự thêm vào Sheet. */
export const SYSTEM_COLUMNS = [
  SHEET.COLUMNS.SYNC_STATUS,
  SHEET.COLUMNS.LEAD_ID,
  SHEET.COLUMNS.SYNCED_AT,
  SHEET.COLUMNS.ERROR,
  SHEET.COLUMNS.SYNC_HASH,
] as const;

/** Cột ẩn để người dùng không vô tình sửa. */
const HIDDEN_COLUMNS: readonly string[] = [
  SHEET.COLUMNS.LEAD_ID,
  SHEET.COLUMNS.SYNC_HASH,
];

const EMPTY: SheetCell = { text: '' };

/**
 * Đọc toàn bộ tab trong một lệnh và dựng ảnh chụp Sheet: tiêu đề, vị trí từng
 * cột, các hàng có dữ liệu. Sheet chưa có cột kết quả thì thêm vào cuối dòng
 * tiêu đề và ẩn hai cột Lead ID, Sync Hash.
 */
@Injectable()
export class SheetReaderService {
  private readonly logger = new ServiceLogger(
    LogService.SYNC,
    SheetReaderService.name,
  );

  constructor(
    private readonly sheets: SheetsClient,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async read(): Promise<SheetSnapshot> {
    const { spreadsheetId, sheetName } = requireSheetConfig(this.config);
    const tab = await this.sheets.assertTab(spreadsheetId, sheetName);
    const grid = await this.sheets.readGrid(spreadsheetId, sheetName);
    let headers = headerTexts(grid[0] ?? []);
    const missing = SYSTEM_COLUMNS.filter((name) => !headers.includes(name));
    if (missing.length > 0) {
      await this.addSystemColumns(
        spreadsheetId,
        sheetName,
        tab,
        headers.length,
        missing,
      );
      headers = [...headers, ...missing];
    }
    return buildSnapshot(tab.sheetId, headers, grid.slice(1));
  }

  /** Đọc lại Sheet (dùng trước khi ghi kết quả, để tìm lại đúng hàng). */
  async reread(sheetId: number): Promise<SheetSnapshot> {
    const { spreadsheetId, sheetName } = requireSheetConfig(this.config);
    const grid = await this.sheets.readGrid(spreadsheetId, sheetName);
    return buildSnapshot(sheetId, headerTexts(grid[0] ?? []), grid.slice(1));
  }

  private async addSystemColumns(
    spreadsheetId: string,
    sheetName: string,
    tab: SheetTab,
    start: number,
    names: string[],
  ): Promise<void> {
    const end = start + names.length;
    if (tab.columnCount < end) {
      await this.sheets.batchUpdate(spreadsheetId, [
        {
          appendDimension: {
            sheetId: tab.sheetId,
            dimension: 'COLUMNS',
            length: end - tab.columnCount,
          },
        },
      ]);
    }
    await this.sheets.updateValues(spreadsheetId, [
      {
        range: `${quoteSheetName(sheetName)}!${columnLetter(start)}1:${columnLetter(end - 1)}1`,
        values: [names],
      },
    ]);
    const hide = names
      .map((name, i) => ({ name, index: start + i }))
      .filter(({ name }) => HIDDEN_COLUMNS.includes(name))
      .map(({ index }) => ({
        updateDimensionProperties: {
          range: {
            sheetId: tab.sheetId,
            dimension: 'COLUMNS',
            startIndex: index,
            endIndex: index + 1,
          },
          properties: { hiddenByUser: true },
          fields: 'hiddenByUser',
        },
      }));
    await this.sheets.batchUpdate(spreadsheetId, hide);
    this.logger.log(LOG.SYNC.COLUMNS_ADDED(names.join(', ')));
  }
}

function headerTexts(row: SheetCell[]): string[] {
  const headers = row.map((cell) => cell.text.trim());
  while (headers.length > 0 && headers[headers.length - 1] === '')
    headers.pop();
  return headers;
}

/** Dựng ảnh chụp từ dòng tiêu đề và các hàng dữ liệu (dòng 2 trở đi). */
export function buildSnapshot(
  sheetId: number,
  headers: string[],
  dataRows: SheetCell[][],
): SheetSnapshot {
  const columnIndex = new Map<string, number>();
  headers.forEach((header, index) => {
    if (header && !columnIndex.has(header)) columnIndex.set(header, index);
  });
  const systemSet = new Set<string>(SYSTEM_COLUMNS);
  const dataColumns = [...columnIndex.keys()].filter((h) => !systemSet.has(h));
  const cellAt = (cells: SheetCell[], header: string) =>
    cells[columnIndex.get(header) ?? -1] ?? EMPTY;

  const rows: SheetRow[] = [];
  dataRows.forEach((cells, i) => {
    const byHeader = new Map(
      dataColumns.map((h) => [h, cellAt(cells, h)] as const),
    );
    const texts = dataColumns.map((h) => byHeader.get(h)!.text);
    if (texts.every((t) => t === '')) return;
    rows.push({
      rowNumber: i + 2,
      cells: byHeader,
      leadIdText: cellAt(cells, SHEET.COLUMNS.LEAD_ID).text,
      syncHash: cellAt(cells, SHEET.COLUMNS.SYNC_HASH).text,
      syncStatus: cellAt(cells, SHEET.COLUMNS.SYNC_STATUS).text,
      errorText: cellAt(cells, SHEET.COLUMNS.ERROR).text,
      fingerprint: contentFingerprint(texts),
    });
  });
  return { sheetId, headers, columnIndex, rows };
}
