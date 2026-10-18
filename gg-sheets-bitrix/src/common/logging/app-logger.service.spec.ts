import { ConsoleLogger } from '@nestjs/common';
import { AppLogger } from './app-logger.service';
import { logFiles } from './log-files';

describe('AppLogger: dòng ghi vào app.log', () => {
  let write: jest.SpyInstance;

  beforeEach(() => {
    write = jest.spyOn(logFiles, 'write').mockImplementation(() => undefined);
    // Không in ra console khi chạy test.
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn(ConsoleLogger.prototype, level)
        .mockImplementation(() => undefined);
    }
  });

  afterEach(() => jest.restoreAllMocks());

  const lastLine = () => write.mock.calls.at(-1) as [string, string];

  it('tách service và lớp từ context "service_xxx:Lop"', () => {
    new AppLogger().log('read 150 rows', 'service_sync:SyncRunnerService');

    const [file, line] = lastLine();
    expect(file).toBe('app.log');
    expect(line).toMatch(
      /^\S+ \| LOG {3}\| service_sync \| - \| \[SyncRunnerService\] read 150 rows$/,
    );
  });

  it('error(message, stack): tham số thứ hai là stack trace, không bị lấy làm context', () => {
    const error = new Error('hỏng');
    new AppLogger('service_api:AllExceptionsFilter').error(
      'POST /sync/run -> 500',
      error.stack,
    );

    const [, line] = lastLine();
    const [firstLine] = line.split('\n');
    expect(firstLine).toMatch(
      /\| ERROR \| service_api \| - \| \[AllExceptionsFilter\] POST \/sync\/run -> 500$/,
    );
    expect(line).toContain('\n    at ');
  });

  it('log không gắn service (log của Nest, khởi động) ghi là "system"', () => {
    new AppLogger('Bootstrap').warn('Chưa cấu hình API_KEY');

    expect(lastLine()[1]).toContain('| WARN  | system | - | [Bootstrap]');
  });
});
