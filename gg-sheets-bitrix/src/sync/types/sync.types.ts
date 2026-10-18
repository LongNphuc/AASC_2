import type { StatusKbn } from '../../common/kbn/status.kbn';
import type { SheetCell } from '../../google/types/sheets.types';

/** Số hàng theo kết quả của một lần chạy (cột sync_runs.summary). */
export interface RunSummary {
  total_rows: number;
  skipped_rows: number;
  invalid_rows: number;
  upload_succeeded: { created: number; updated: number };
  upload_failed: number;
  pending_rows: number;
}

/** summary của batch làm mới token Google: token mới thuộc tài khoản nào, hết hạn lúc nào. */
export interface TokenRunSummary {
  account_email: string | null;
  expires_at: string;
}

/** Cột sync_runs.summary: dạng tùy loại batch. */
export type AnyRunSummary = RunSummary | TokenRunSummary;

export function isRowSummary(
  summary: AnyRunSummary | null | undefined,
): summary is RunSummary {
  return !!summary && 'total_rows' in summary;
}

/** Kết quả một lần chạy, ghi vào sync_runs. */
export interface RunOutcome {
  statusKbn: StatusKbn;
  errorKbn?: number;
  errorDetail?: string;
  summary: AnyRunSummary | null;
  problemRows: ProblemGroup[] | null;
}

/** Một hàng trong một nhóm problem_rows. */
export interface ProblemRowRef {
  row: number;
  name: string;
  lead_id?: number;
}

/** Một phần tử của sync_runs.problem_rows: các hàng có cùng lý do. */
export interface ProblemGroup {
  status_kbn: number;
  error_kbn: number;
  message: string;
  retry_after?: string;
  rows: ProblemRowRef[];
}

/** Một hàng dữ liệu đọc từ Sheet. */
export interface SheetRow {
  /** Số hàng trên Sheet (dòng 1 là tiêu đề). */
  rowNumber: number;
  /** Ô theo tên cột (tiêu đề đã bỏ khoảng trắng hai đầu). */
  cells: Map<string, SheetCell>;
  /** Giá trị đang có ở 5 cột kết quả. */
  leadIdText: string;
  syncHash: string;
  syncStatus: string;
  errorText: string;
  /** Dấu vân tay nội dung lúc đọc, để tìm lại hàng khi ghi kết quả. */
  fingerprint: string;
}

/** Ảnh chụp Sheet ở đầu lần chạy. */
export interface SheetSnapshot {
  sheetId: number;
  headers: string[];
  /** Vị trí (0-based) của từng cột theo tên. */
  columnIndex: Map<string, number>;
  rows: SheetRow[];
}
