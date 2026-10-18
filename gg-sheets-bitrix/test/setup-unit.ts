import { Logger } from '@nestjs/common';

// Tắt log của Nest khi chạy unit test để kết quả test dễ đọc. Không dùng
// Logger.overrideLogger(false) vì Test.createTestingModule().compile() gắn lại
// logger riêng của nó.
for (const level of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
  jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
}
