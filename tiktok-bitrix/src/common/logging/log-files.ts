import { createWriteStream, mkdirSync, WriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { maskSecrets } from './redact';

/**
 * Ghi dòng log vào tệp trong LOG_DIR (readme_design.md mục 15):
 *   app.log                   dòng thời gian của mọi sự kiện, cả api và worker
 *   services/<service>.log    chi tiết từng việc của một service
 *
 * Là hạ tầng dùng chung nên chỉ có một bản, cấu hình một lần lúc khởi động
 * (main.ts, worker.ts, mock-server.ts). Chưa cấu hình (ví dụ khi chạy unit
 * test) thì không ghi gì.
 */
class LogFiles {
  private dir?: string;
  private processRole = 'app';
  private closed = false;
  private readonly streams = new Map<string, WriteStream>();

  /** `role` là tên process (api, worker, mock), in ở mỗi dòng app.log. */
  configure(dir: string, role: string): void {
    this.dir = dir;
    this.processRole = role;
    this.closed = false;
    mkdirSync(join(dir, 'services'), { recursive: true });
  }

  get role(): string {
    return this.processRole;
  }

  /** Ghi một dòng; mọi dòng đều được che URL webhook, chữ ký, token. */
  write(relativePath: string, line: string): void {
    if (!this.dir || this.closed) {
      return;
    }
    this.streamFor(relativePath).write(`${maskSecrets(line)}\n`);
  }

  /**
   * Đóng mọi tệp và chờ ghi hết dữ liệu còn trong bộ đệm. Gọi trước khi thoát
   * tiến trình, để dòng log cuối (lý do lỗi) không bị mất.
   */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(
      [...this.streams.values()].map(
        (stream) => new Promise<void>((resolve) => stream.end(resolve)),
      ),
    );
    this.streams.clear();
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
