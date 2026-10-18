import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { logFiles } from './log-files';
import { maskWebhookUrl } from './redact';
import { requestContext } from './request-context';
import { RequestLoggingMiddleware } from './request-logging.middleware';
import { serviceForPath } from './route-services';

describe('logging', () => {
  it('che mã trong URL webhook', () => {
    expect(
      maskWebhookUrl(
        'gọi https://p.bitrix24.vn/rest/1/abcXYZ/crm.lead.add.json',
      ),
    ).toBe('gọi https://p.bitrix24.vn/rest/1/***/crm.lead.add.json');
  });

  it('đường dẫn nào ghi vào log service nào', () => {
    expect(serviceForPath('/sync/run')).toBe('service_api');
    expect(serviceForPath('/mapping')).toBe('service_api');
    expect(serviceForPath('/health')).toBeUndefined();
    expect(serviceForPath('/admin/index.html')).toBeUndefined();
  });

  it('request_id giữ suốt chuỗi async', async () => {
    const id = await requestContext.run('abc', async () => {
      await Promise.resolve();
      return requestContext.requestId();
    });
    expect(id).toBe('abc');
    expect(requestContext.requestId()).toBeUndefined();
  });

  it('middleware: cấp x-request-id; trả lời xong ghi một dòng vào log service', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'logs-'));
    logFiles.configure(dir);
    let finish: () => void = () => undefined;
    const res = {
      statusCode: 409,
      locals: {
        errorLog: { errorKbn: 60001, errorDetail: 'SYNC_BUSY: đang chạy' },
      },
      setHeader: jest.fn(),
      on: (_: string, cb: () => void) => (finish = cb),
    } as unknown as Response;
    const req = { method: 'POST', originalUrl: '/sync/run?x=1' } as Request;
    const next = jest.fn() as NextFunction;

    new RequestLoggingMiddleware().use(req, res, next);
    finish();
    await logFiles.close();

    expect(next).toHaveBeenCalled();
    expect((res.setHeader as jest.Mock).mock.calls[0][0]).toBe('x-request-id');
    const line = readFileSync(join(dir, 'services', 'service_api.log'), 'utf8');
    expect(line).toMatch(
      /POST \/sync\/run 409 \| status_kbn=10001\(FAILED\) \| error_kbn=60001\(SYNC.BUSY\)/,
    );
    expect(line).not.toContain('x=1');
  });
});
