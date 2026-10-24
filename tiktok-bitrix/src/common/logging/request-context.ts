import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Giữ "mã" của việc đang chạy, để mọi dòng log sinh ra trong đó (ở bất kỳ
 * service nào) mang cùng một mã (readme_design.md mục 15):
 *
 * - request HTTP: 8 ký tự ngẫu nhiên, trả về trong header x-request-id;
 * - job: 8 ký tự đầu của webhook_event_uuid (job-context.ts), cũng là mã in
 *   trong comment timeline trên Bitrix24.
 *
 * Nhờ vậy `grep <mã> logs/services/*.log` ra toàn bộ đường đi của một request
 * hay một sự kiện. AsyncLocalStorage giữ giá trị xuyên suốt chuỗi async mà
 * không phải truyền tham số qua từng hàm.
 */
const storage = new AsyncLocalStorage<{ code: string }>();

export const logContext = {
  run<T>(code: string, fn: () => T): T {
    return storage.run({ code }, fn);
  },

  /** Mã hiện tại; undefined nếu đang chạy ngoài request, job (ví dụ lúc khởi động). */
  code(): string | undefined {
    return storage.getStore()?.code;
  },
};
