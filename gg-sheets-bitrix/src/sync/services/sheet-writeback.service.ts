import { Inject, Injectable } from '@nestjs/common';
import { SHEET } from '../../common/constants/messages.constant';
import { appConfig, type AppConfig } from '../../config/app-config';
import { SheetsClient } from '../../google/clients/sheets.client';
import { cellRange } from '../../google/helpers/a1-notation';
import { requireSheetConfig } from '../../google/helpers/sheet-config';
import type { ValueRange } from '../../google/types/sheets.types';
import { formatTimestamp } from '../helpers/schedule';
import type { SheetRow, SheetSnapshot } from '../types/sync.types';
import { SheetReaderService } from './sheet-reader.service';

/** Những ô cần ghi cho một hàng; trường không có thì không ghi ô đó. */
export interface RowWrite {
  row: SheetRow;
  status?: string;
  leadId?: number;
  /** Ghi thời điểm hiện tại vào "Thời gian đồng bộ cuối". */
  syncedAt?: boolean;
  /** Chuỗi: ghi lý do; null: xóa ô lỗi. */
  error?: string | null;
  hash?: string;
  /** Ô dữ liệu cần ghi theo tên cột (giá trị lấy từ Bitrix24 về). */
  cells?: Record<string, string | number>;
}

export interface WritebackResult {
  cells: number;
  /** Hàng không tìm lại được (bị xóa, hoặc vừa bị sửa). */
  notLocated: number[];
}

/**
 * Ghi kết quả về Sheet trong một lệnh values.batchUpdate. Trước khi ghi, đọc
 * lại Sheet và tìm hàng theo dấu vân tay nội dung, vì trong lúc chạy có thể có
 * người chèn hoặc xóa hàng làm số hàng thay đổi.
 */
@Injectable()
export class SheetWritebackService {
  constructor(
    private readonly reader: SheetReaderService,
    private readonly sheets: SheetsClient,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async write(
    snapshot: SheetSnapshot,
    writes: RowWrite[],
    now = new Date(),
  ): Promise<WritebackResult> {
    if (writes.length === 0) return { cells: 0, notLocated: [] };
    const { spreadsheetId, sheetName } = requireSheetConfig(this.config);
    const current = await this.reader.reread(snapshot.sheetId);
    const located = locateRows(current, writes);
    const timestamp = formatTimestamp(now, this.config.sync.timezone);

    const ranges: ValueRange[] = [];
    const put = (row: number, column: string, value: string | number) => {
      const index = current.columnIndex.get(column);
      if (index !== undefined)
        ranges.push({
          range: cellRange(sheetName, row, index),
          values: [[value]],
        });
    };
    for (const { write, rowNumber } of located.found) {
      if (write.status !== undefined)
        put(rowNumber, SHEET.COLUMNS.SYNC_STATUS, write.status);
      if (write.leadId !== undefined)
        put(rowNumber, SHEET.COLUMNS.LEAD_ID, write.leadId);
      if (write.syncedAt) put(rowNumber, SHEET.COLUMNS.SYNCED_AT, timestamp);
      if (write.error !== undefined)
        put(rowNumber, SHEET.COLUMNS.ERROR, write.error ?? '');
      if (write.hash !== undefined)
        put(rowNumber, SHEET.COLUMNS.SYNC_HASH, write.hash);
      for (const [header, value] of Object.entries(write.cells ?? {}))
        put(rowNumber, header, value);
    }
    const cells = await this.sheets.updateValues(spreadsheetId, ranges);
    return { cells, notLocated: located.notLocated };
  }
}

/**
 * Ghép mỗi hàng cần ghi với vị trí hiện tại của nó: ưu tiên đúng số hàng cũ
 * nếu nội dung vẫn vậy; không thì hàng đầu tiên chưa dùng có cùng dấu vân tay.
 */
export function locateRows(
  current: SheetSnapshot,
  writes: RowWrite[],
): { found: { write: RowWrite; rowNumber: number }[]; notLocated: number[] } {
  const byFingerprint = new Map<string, number[]>();
  for (const row of current.rows) {
    byFingerprint.set(row.fingerprint, [
      ...(byFingerprint.get(row.fingerprint) ?? []),
      row.rowNumber,
    ]);
  }
  const used = new Set<number>();
  const found: { write: RowWrite; rowNumber: number }[] = [];
  const notLocated: number[] = [];
  const ordered = [...writes].sort((a, b) => a.row.rowNumber - b.row.rowNumber);
  // Lượt 1: hàng còn ở đúng chỗ cũ.
  const pending: RowWrite[] = [];
  for (const write of ordered) {
    const candidates = byFingerprint.get(write.row.fingerprint) ?? [];
    if (
      candidates.includes(write.row.rowNumber) &&
      !used.has(write.row.rowNumber)
    ) {
      used.add(write.row.rowNumber);
      found.push({ write, rowNumber: write.row.rowNumber });
    } else {
      pending.push(write);
    }
  }
  // Lượt 2: hàng đã dời chỗ.
  for (const write of pending) {
    const rowNumber = (byFingerprint.get(write.row.fingerprint) ?? []).find(
      (n) => !used.has(n),
    );
    if (rowNumber === undefined) {
      notLocated.push(write.row.rowNumber);
    } else {
      used.add(rowNumber);
      found.push({ write, rowNumber });
    }
  }
  return { found, notLocated };
}
