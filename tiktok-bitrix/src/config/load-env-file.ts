import { existsSync } from 'node:fs';

/**
 * Đọc tệp .env vào process.env ngay khi tiến trình bắt đầu, trước khi Nest
 * khởi tạo. Cần để biết LOG_DIR sớm, nhờ đó lỗi xảy ra trong lúc khởi tạo
 * (ví dụ biến môi trường sai) cũng được ghi vào app.log.
 *
 * Biến đã có sẵn trong môi trường (ví dụ Docker truyền vào) không bị ghi đè.
 * Không có tệp .env thì bỏ qua. ConfigModule vẫn đọc .env như bình thường.
 */
export function loadEnvFileIfPresent(path = '.env'): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}
