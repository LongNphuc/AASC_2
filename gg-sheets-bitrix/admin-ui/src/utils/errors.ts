import { ApiError } from '../api/client';
import { showMessage } from '../stores/dialogs';

/** Hiện lỗi API trong hộp thoại: thông báo, error_kbn và danh sách lỗi chi tiết (nếu có). */
export function showApiError(title: string, error: unknown): void {
  if (error instanceof ApiError) {
    const kbn = error.body.errorKbn ? ` (error_kbn ${error.body.errorKbn})` : '';
    showMessage(title, `${error.message}${kbn}`, { tone: 'error', errors: error.body.details?.errors ?? [] });
    return;
  }
  showMessage(title, error instanceof Error ? error.message : String(error), { tone: 'error' });
}
