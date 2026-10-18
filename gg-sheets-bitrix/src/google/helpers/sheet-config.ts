import { ERROR } from '../../common/constants/messages.constant';
import { ExternalApiError } from '../../common/errors/external-api.error';
import type { AppConfig } from '../../config/app-config';

/** Spreadsheet ID và tên tab từ .env; thiếu thì báo lỗi cấu hình rõ tên biến. */
export function requireSheetConfig(config: AppConfig): {
  spreadsheetId: string;
  sheetName: string;
} {
  const { spreadsheetId, sheetName } = config.google;
  if (!spreadsheetId || !sheetName) {
    throw new ExternalApiError(
      'google-sheets',
      'CONFIG',
      ERROR.SYSTEM.MISSING_CONFIG(
        !spreadsheetId ? 'GOOGLE_SPREADSHEET_ID' : 'GOOGLE_SHEET_NAME',
      ),
    );
  }
  return { spreadsheetId, sheetName };
}
