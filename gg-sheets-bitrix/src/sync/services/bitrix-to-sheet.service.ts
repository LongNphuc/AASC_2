import { HttpStatus, Injectable } from '@nestjs/common';
import { BitrixWebhookClient } from '../../bitrix/clients/bitrix-webhook.client';
import { BitrixMetadataService } from '../../bitrix/services/bitrix-metadata.service';
import type { LeadMetadata } from '../../bitrix/types/bitrix.types';
import { ERROR, LOG, WARN } from '../../common/constants/messages.constant';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { StatusKbn } from '../../common/kbn/status.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import type { SheetCell } from '../../google/types/sheets.types';
import { bitrixOwnedColumns } from '../../mapping/helpers/ownership';
import {
  sameValue,
  toSheetValue,
} from '../../mapping/mappers/lead-to-row.mapper';
import { MappingValidatorService } from '../../mapping/services/mapping-validator.service';
import { MappingService } from '../../mapping/services/mapping.service';
import type { MappingColumn } from '../../mapping/types/mapping.types';
import type { SheetRow } from '../types/sync.types';
import { SheetReaderService } from './sheet-reader.service';
import { RowWrite, SheetWritebackService } from './sheet-writeback.service';

const EMPTY: SheetCell = { text: '' };

type Lead = Record<string, unknown>;

/** Kết quả đồng bộ một lead từ Bitrix24 về Sheet. */
export interface SyncBackResult {
  leadId: number;
  /** Số hàng trên Sheet có Lead ID này. */
  rows: number;
  /** Hàng đã ghi giá trị mới từ Bitrix24. */
  updatedRows: number[];
  /** Từng ô đã đổi, ví dụ "row 5: Trạng thái 'Chưa giao người xử lý' → 'Trong tiến trình'". */
  changes: string[];
  /** Hàng không tìm lại được khi ghi (bị xóa hoặc vừa bị sửa). */
  notLocated: number[];
}

/**
 * Đồng bộ một lead từ Bitrix24 về Google Sheet, gọi khi Bitrix24 báo lead vừa
 * thay đổi (webhook đi). Chỉ các cột có owner: bitrix trong mapping (ví dụ
 * trạng thái, người phụ trách do sales đổi trên CRM) đi theo chiều này; các cột
 * khác vẫn do Sheet làm chủ (priority-based conflict resolution).
 *
 *   crm.lead.get(ID) → đọc Sheet → các hàng có Lead ID đó → so từng ô với giá
 *   trị trên Bitrix24 → ghi các ô khác nhau (kèm "Thời gian đồng bộ cuối")
 *
 * Không đụng hash: hash chỉ tính trường do Sheet làm chủ, nên ghi các ô này
 * không làm lần chạy Sheet → Bitrix24 sau đó coi hàng là "đã sửa".
 */
@Injectable()
export class BitrixToSheetService {
  private readonly logger = new ServiceLogger(
    LogService.SYNC,
    BitrixToSheetService.name,
  );

  constructor(
    private readonly mappings: MappingService,
    private readonly validator: MappingValidatorService,
    private readonly reader: SheetReaderService,
    private readonly writeback: SheetWritebackService,
    private readonly metadata: BitrixMetadataService,
    private readonly bitrix: BitrixWebhookClient,
  ) {}

  async syncLead(leadId: number): Promise<SyncBackResult> {
    const columns = await this.ownedColumns();
    const lead = await this.bitrix.call<Lead>('crm.lead.get', { id: leadId });
    const snapshot = await this.reader.read();
    const metadata = await this.metadata.loadForRun(
      columns.map((c) => c.field),
    );
    const issues = this.validator.validateAgainst(
      { columns, duplicate_keys: [] },
      snapshot.headers,
      metadata,
    );
    if (issues.length > 0) {
      throw mappingInvalid(
        ERROR.SYNC.MAPPING_INVALID(issues.length, issues[0].message),
        issues[0].errorKbn,
      );
    }

    const rows = snapshot.rows.filter(
      (row) => row.leadIdText.trim() === String(leadId),
    );
    const writes: RowWrite[] = [];
    const changes: string[] = [];
    for (const row of rows) {
      const diff = diffRow(row, lead, columns, metadata);
      if (!diff) continue;
      writes.push(diff.write);
      for (const change of diff.changes) {
        changes.push(`row ${row.rowNumber}: ${change}`);
        this.logger.record({
          method: LOG.SYNC.PULLED(row.rowNumber, change),
          statusKbn: StatusKbn.SUCCESS,
        });
      }
    }

    const done = await this.writeback.write(snapshot, writes);
    for (const row of done.notLocated)
      this.logger.warn(WARN.SYNC.ROW_NOT_LOCATED(row));
    const updatedRows = writes
      .map((w) => w.row.rowNumber)
      .filter((row) => !done.notLocated.includes(row));
    this.logger.record({
      method: LOG.WEBHOOK.SYNCED(leadId, rows.length, updatedRows.length),
      statusKbn:
        done.notLocated.length > 0 ? StatusKbn.PARTIAL : StatusKbn.SUCCESS,
    });
    return {
      leadId,
      rows: rows.length,
      updatedRows,
      changes,
      notLocated: done.notLocated,
    };
  }

  /** Cột owner: bitrix của mapping đang dùng; không có thì không có gì để đồng bộ. */
  private async ownedColumns(): Promise<MappingColumn[]> {
    const mapping = await this.mappings.latest();
    if (!mapping) throw mappingInvalid(ERROR.SYNC.NO_MAPPING);
    const structure = this.validator.validateStructure(mapping.mappingJson);
    if (!structure.config) {
      throw mappingInvalid(
        ERROR.SYNC.MAPPING_INVALID(
          structure.issues.length,
          structure.issues[0].message,
        ),
      );
    }
    const columns = bitrixOwnedColumns(structure.config, 'both');
    if (columns.length === 0) throw mappingInvalid(ERROR.SYNC.NO_OWNED_COLUMNS);
    return columns;
  }
}

/** Các ô của một hàng khác giá trị trên Bitrix24; không có gì khác thì null. */
export function diffRow(
  row: SheetRow,
  lead: Lead,
  columns: MappingColumn[],
  metadata: LeadMetadata,
): { write: RowWrite; changes: string[] } | null {
  const cells: Record<string, string | number> = {};
  const changes: string[] = [];
  for (const column of columns) {
    if (column.header in cells) continue;
    const field = metadata.fields[column.field];
    const cell = row.cells.get(column.header) ?? EMPTY;
    const value = lead[column.field];
    if (sameValue(column, field, cell, value, metadata)) continue;
    const next = toSheetValue(column, field, value, metadata);
    cells[column.header] = next;
    changes.push(`${column.header} '${cell.text}' → '${next}'`);
  }
  if (changes.length === 0) return null;
  return { write: { row, cells, syncedAt: true }, changes };
}

function mappingInvalid(
  message: string,
  errorKbn: number = ErrorKbn.MAPPING_INVALID,
): KbnHttpException {
  return new KbnHttpException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    errorKbn,
    ERROR.LABEL.MAPPING_INVALID,
    message,
  );
}
