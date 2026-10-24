import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logCode, runInJobContext } from './job-context';
import { logFiles } from './log-files';
import { maskSecrets, maskWebhookUrl } from './redact';
import { logContext } from './request-context';
import { serviceForPath } from './route-services';
import {
  formatServiceLine,
  LogService,
  ServiceLogger,
  writeServiceLog,
} from './service-logger';
import { AppLogger, logLevelsFor } from './app-logger.service';

describe('redact', () => {
  it('che URL webhook Bitrix24, chữ ký, token', () => {
    expect(
      maskWebhookUrl('https://a.bitrix24.vn/rest/1/abc123/crm.lead.add'),
    ).toBe('https://a.bitrix24.vn/rest/1/***/crm.lead.add');
    expect(maskSecrets('t=1709876543,s=8b2c6f0e9a4d5a8f0c6b')).toBe(
      't=1709876543,s=***',
    );
    expect(maskSecrets('Access-Token: abc.def')).toBe('Access-Token: ***');
    expect(maskSecrets('auth[application_token]=k3v9q2&x=1')).toContain('***');
  });
});

describe('service log', () => {
  it('định dạng: thời gian | mức | service | mã | việc | kết quả | error_kbn | thời gian chạy | chi tiết', () => {
    const line = formatServiceLine(
      LogService.JOB,
      {
        action: 'tiktok-event · bước 11109',
        result: 'FAILED',
        errorKbn: 40010,
        durationMs: 12,
        detail: 'a\nb',
      },
      '6f1d2c3a',
      new Date('2026-10-22T03:10:00.120Z'),
    );
    expect(line).toBe(
      '2026-10-22T03:10:00.120Z | ERROR | job | 6f1d2c3a | tiktok-event · bước 11109 | FAILED | 40010(BITRIX24.SERVER) | 12ms | a b',
    );
    expect(
      formatServiceLine(
        LogService.API,
        { action: 'GET', result: 'SUCCESS' },
        undefined,
      ),
    ).toContain('| INFO  | api | - | GET | SUCCESS | - | - | -');
  });

  it('ghi tệp services/*.log và app.log khi đã cấu hình LOG_DIR, mang mã của ngữ cảnh', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'logs-'));
    logFiles.configure(dir, 'test');
    expect(logFiles.role).toBe('test');
    await runInJobContext('abcdef12-3456', () => {
      writeServiceLog(LogService.LEAD, { action: 'x', result: 'OK' });
      new ServiceLogger(LogService.LEAD, 'Lớp').record({
        action: 'y',
        result: 'OK',
      });
      new AppLogger('Ctx').log('xin chào', 'service_lead:Lớp');
      new AppLogger('Ctx').error('lỗi', 'Error: x\n    at f (a.ts:1:1)');
      new AppLogger('Ctx').warn({ a: 1 });
      return Promise.resolve();
    });
    logFiles.write('app.log', 'url /rest/1/secret/x');
    await logFiles.close();
    const service = readFileSync(
      join(dir, 'services', 'service_lead.log'),
      'utf8',
    );
    expect(service).toContain('| abcdef12 | x | OK');
    const app = readFileSync(join(dir, 'app.log'), 'utf8');
    expect(app).toContain('| test | service_lead | abcdef12 | [Lớp] xin chào');
    expect(app).toContain('/rest/1/***/x');
    logFiles.write('app.log', 'sau khi đóng: bỏ qua');
  });

  it('mã log, ngữ cảnh, service theo đường dẫn, mức log', () => {
    expect(logCode('6f1d2c3a-xxxx')).toBe('6f1d2c3a');
    expect(logContext.code()).toBeUndefined();
    expect(logContext.run('abc', () => logContext.code())).toBe('abc');
    expect(serviceForPath('/webhooks/tiktok/leads')).toBe(LogService.WEBHOOK);
    expect(serviceForPath('/api/v1/leads')).toBe(LogService.API);
    expect(serviceForPath('/health')).toBeUndefined();
    expect(logLevelsFor('info')).toEqual(['fatal', 'error', 'warn', 'log']);
    expect(logLevelsFor('error')).toEqual(['fatal', 'error']);
    expect(logLevelsFor('lạ')).toHaveLength(4);
  });
});
