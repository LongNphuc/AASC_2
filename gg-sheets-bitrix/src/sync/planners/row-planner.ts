import type { LeadMetadata } from '../../bitrix/types/bitrix.types';
import { SHEET, VALIDATION } from '../../common/constants/messages.constant';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { withoutFields } from '../../mapping/helpers/ownership';
import {
  mapRow,
  MappedRow,
  RowIssue,
} from '../../mapping/mappers/row-to-lead.mapper';
import type { MappingConfig } from '../../mapping/types/mapping.types';
import type { SheetRow } from '../types/sync.types';
import { syncHash } from './row-hash';

export type PlanAction =
  'INVALID' | 'SKIP' | 'REFRESH_STATUS' | 'UPDATE' | 'NEW';

export interface RowPlan {
  row: SheetRow;
  action: PlanAction;
  mapped: MappedRow;
  hash: string;
  leadId?: number;
  issue?: RowIssue;
}

/**
 * Quyết định cho từng hàng:
 *   chuẩn hóa + kiểm tra sai           → INVALID (không gửi)
 *   có Lead ID, hash cũ trống / khác   → UPDATE
 *   có Lead ID, hash giống             → SKIP, hoặc REFRESH_STATUS nếu ô trạng thái đang "Lỗi"/"Chờ"
 *   chưa có Lead ID                    → NEW (tra trùng rồi LINK hoặc CREATE)
 *
 * `owned`: trường do Bitrix24 làm chủ (đồng bộ hai chiều). Hash không tính các
 * trường này, nên Bitrix24 ghi giá trị mới về Sheet không làm hàng bị coi là
 * "đã sửa"; với hàng đã có lead, lỗi ở các cột này cũng không chặn hàng (giá
 * trị của chúng lấy theo Bitrix24).
 */
export function planRows(
  rows: SheetRow[],
  mapping: MappingConfig,
  metadata: LeadMetadata,
  owned: ReadonlySet<string> = new Set(),
): RowPlan[] {
  return rows.map((row) => {
    const mapped = mapRow(row.cells, mapping, metadata);
    const hash = syncHash(withoutFields(mapped.payload, owned));
    const leadIdText = row.leadIdText.trim();
    const leadId = leadIdText ? Number(leadIdText) : undefined;
    const issues =
      leadId === undefined
        ? mapped.issues
        : mapped.issues.filter((i) => !i.field || !owned.has(i.field));

    if (leadIdText && !(Number.isInteger(leadId) && leadId! > 0)) {
      const issue = {
        errorKbn: ErrorKbn.VALIDATION,
        message: VALIDATION.ROW.LEAD_ID_INVALID(leadIdText),
      };
      return { row, action: 'INVALID', mapped, hash, issue };
    }
    if (issues.length > 0) {
      const issue = {
        errorKbn: issues[0].errorKbn,
        message: issues.map((i) => i.message).join('; '),
      };
      return { row, action: 'INVALID', mapped, hash, issue, leadId };
    }
    if (leadId === undefined) return { row, action: 'NEW', mapped, hash };
    if (row.syncHash && row.syncHash === hash) {
      const action =
        row.syncStatus === SHEET.STATUS.SYNCED ? 'SKIP' : 'REFRESH_STATUS';
      return { row, action, mapped, hash, leadId };
    }
    return { row, action: 'UPDATE', mapped, hash, leadId };
  });
}
