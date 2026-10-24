import { ConsoleLogger, Logger } from '@nestjs/common';

// Tắt log của Nest khi chạy test để kết quả dễ đọc. Không dùng
// Logger.overrideLogger(false) vì Test.createTestingModule().compile() gắn lại
// logger riêng của nó.
for (const level of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
  jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
}

// AppLogger kế thừa ConsoleLogger: tắt phần in ra console, phần ghi tệp vẫn chạy.
type Printer = Record<'printMessages' | 'printStackTrace', () => void>;
for (const method of ['printMessages', 'printStackTrace'] as const) {
  jest
    .spyOn(ConsoleLogger.prototype as unknown as Printer, method)
    .mockImplementation(() => undefined);
}
