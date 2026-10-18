import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Giữ mã của request HTTP (request_id) hoặc của lần chạy (8 ký tự đầu
 * run_uuid), để mọi dòng log sinh ra trong đó (ở bất kỳ service nào) mang
 * cùng một mã. Nhờ vậy lần được một request hay một lần chạy xuyên qua
 * app.log và các tệp services/*.log.
 *
 * AsyncLocalStorage giữ giá trị xuyên suốt chuỗi async (await, callback) mà
 * không phải truyền tham số qua từng hàm.
 */
const storage = new AsyncLocalStorage<{ requestId: string }>();

export const requestContext = {
  run<T>(requestId: string, fn: () => T): T {
    return storage.run({ requestId }, fn);
  },

  /** request_id hiện tại; undefined nếu đang chạy ngoài request (ví dụ lúc khởi động). */
  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
