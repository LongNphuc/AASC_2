import { reactive } from 'vue';
import type { MappingIssue } from '../api/types';

/**
 * Trạng thái các hộp thoại dùng chung (nhập API key, xác nhận, thông báo),
 * mở bằng hàm trả Promise để code gọi viết tuần tự: `if (await confirm(...))`.
 */
export const dialogs = reactive({
  apiKey: { open: false, resolve: (() => undefined) as () => void },
  confirm: { open: false, title: '', text: '', resolve: (() => undefined) as (ok: boolean) => void },
  message: {
    open: false,
    title: '',
    text: '',
    tone: 'info' as 'info' | 'error',
    errors: [] as MappingIssue[],
  },
});

export function askApiKey(): Promise<void> {
  return new Promise((resolve) => {
    dialogs.apiKey.open = true;
    dialogs.apiKey.resolve = resolve;
  });
}

export function confirmDialog(title: string, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    Object.assign(dialogs.confirm, { open: true, title, text, resolve });
  });
}

export function showMessage(title: string, text: string, options: { tone?: 'info' | 'error'; errors?: MappingIssue[] } = {}): void {
  Object.assign(dialogs.message, { open: true, title, text, tone: options.tone ?? 'info', errors: options.errors ?? [] });
}
