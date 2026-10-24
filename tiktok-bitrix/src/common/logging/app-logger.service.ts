import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';
import { inspect } from 'node:util';
import { logFiles } from './log-files';
import { logContext } from './request-context';

/**
 * Logger toàn cục: ghi ra console (có màu, như mặc định của Nest) và ghi mỗi
 * sự kiện thành một dòng trong app.log:
 *
 *   thời gian | mức | process | service | mã | [Lớp] nội dung
 *
 * Tên service lấy từ context dạng "service_job:StepRunner" do ServiceLogger
 * đặt. Log của chính Nest (khởi động, nạp module) thuộc "system".
 */
@Injectable()
export class AppLogger extends ConsoleLogger {
  log(message: unknown, ...rest: unknown[]): void {
    super.log(message, ...rest);
    this.writeToFile('log', message, rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    super.warn(message, ...rest);
    this.writeToFile('warn', message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    super.error(message, ...rest);
    this.writeToFile('error', message, rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    super.debug(message, ...rest);
    this.writeToFile('debug', message, rest);
  }

  /**
   * Theo quy ước của Nest, tham số cuối là context; với `error`, tham số trước
   * đó có thể là stack trace.
   */
  private writeToFile(level: LogLevel, message: unknown, rest: unknown[]) {
    if (!this.isLevelEnabled(level)) {
      return;
    }
    const params = [...rest];
    const stack =
      level === 'error' && params.length === 1 && isStackTrace(params[0])
        ? (params.pop() as string)
        : undefined;
    const context =
      typeof params[params.length - 1] === 'string'
        ? (params.pop() as string)
        : (this.context ?? 'App');
    // Logger.error() của Nest chèn undefined vào chỗ stack khi không có stack.
    const extraParams = params.filter((p) => p !== undefined);
    const [service, className] = splitContext(context);
    const text =
      typeof message === 'string'
        ? message
        : inspect(message, { depth: 6, breakLength: Infinity });
    const extra = extraParams.length
      ? ` ${extraParams.map((p) => (typeof p === 'string' ? p : inspect(p))).join(' ')}`
      : '';

    logFiles.write(
      'app.log',
      [
        new Date().toISOString(),
        level.toUpperCase().padEnd(5),
        logFiles.role,
        service,
        logContext.code() ?? '-',
        `[${className}] ${text}${extra}${stack ? `\n${stack}` : ''}`,
      ].join(' | '),
    );
  }
}

function isStackTrace(value: unknown): value is string {
  return typeof value === 'string' && /^(.)+\n\s+at .+:\d+:\d+/.test(value);
}

function splitContext(context: string): [service: string, className: string] {
  const separator = context.indexOf(':');
  return separator > 0
    ? [context.slice(0, separator), context.slice(separator + 1)]
    : ['system', context];
}

/** Mức log theo LOG_LEVEL (error < warn < info < debug). */
export function logLevelsFor(level: string): LogLevel[] {
  const order: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug'];
  const wanted = level === 'info' ? 'log' : (level as LogLevel);
  const index = order.indexOf(wanted);
  return order.slice(0, index >= 0 ? index + 1 : 4);
}
