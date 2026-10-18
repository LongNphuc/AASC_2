import { createWriteStream, mkdirSync, WriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { maskWebhookUrl } from './redact';

/**
 * Ghi dòng log vào tệp trong LOG_DIR:
 *   app.log                   dòng thời gian của mọi sự kiện
 *   services/<service>.log    chi tiết từng lệnh gọi API của một service
 *
 * Là hạ tầng dùng chung nên chỉ có một bản, cấu hình một lần lúc khởi động
 * (main.ts). Chưa cấu hình (ví dụ khi chạy test) thì không ghi gì.
 */
class LogFiles {
  private dir?: string;
  private closed = false;
  private readonly streams = new Map<string, WriteStream>();

  configure(dir: string): void {
    this.dir = dir;
    mkdirSync(join(dir, 'services'), { recursive: true });
  }

  /** Ghi một dòng; mọi dòng đều được che mã bí mật trong URL webhook. */
  write(relativePath: string, line: string): void {
    if (!this.dir || this.closed) {
      return;
    }
    this.streamFor(relativePath).write(`${maskWebhookUrl(line)}\n`);
  }

  /**
   * Đóng mọi tệp và chờ ghi hết dữ liệu còn trong bộ đệm. Gọi trước khi thoát
   * tiến trình vì lỗi, để dòng log cuối (lý do lỗi) không bị mất.
   */
  async close(): Promise<void> {
    // Dòng ghi sau thời điểm này bị bỏ qua: mở luồng mới lúc đang đóng sẽ
    // chen dòng mới lên trước dữ liệu cũ còn trong bộ đệm.
    this.closed = true;
    await Promise.all(
      [...this.streams.values()].map(
        (stream) => new Promise<void>((resolve) => stream.end(resolve)),
      ),
    );
  }

  private streamFor(relativePath: string): WriteStream {
    let stream = this.streams.get(relativePath);
    if (!stream) {
      const path = join(this.dir!, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      stream = createWriteStream(path, { flags: 'a' });
      this.streams.set(relativePath, stream);
    }
    return stream;
  }
}

export const logFiles = new LogFiles();
