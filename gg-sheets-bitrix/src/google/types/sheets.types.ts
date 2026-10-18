/** Một ô Sheets API trả về khi đọc grid (spreadsheets.get). */
export interface ApiCellData {
  formattedValue?: string;
  effectiveValue?: {
    numberValue?: number;
    stringValue?: string;
    boolValue?: boolean;
  };
  effectiveFormat?: { numberFormat?: { type?: string } };
}

/**
 * Một ô đã chuẩn hóa: `text` là chữ người dùng nhìn thấy, `value` là giá trị
 * thật (số, chuỗi, đúng/sai), `formatType` là định dạng số của ô (DATE, NUMBER,
 * CURRENCY, TEXT...), dùng để nhận ra ô ngày tháng (format detection).
 */
export interface SheetCell {
  text: string;
  value?: number | string | boolean;
  formatType?: string;
}

export interface SheetTab {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

export interface SpreadsheetInfo {
  title: string;
  tabs: SheetTab[];
}

/** Một vùng cần ghi bằng values.batchUpdate. */
export interface ValueRange {
  range: string;
  values: (string | number)[][];
}

/** Body lỗi chuẩn của Google API. */
export interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { reason?: string }[];
  };
}
