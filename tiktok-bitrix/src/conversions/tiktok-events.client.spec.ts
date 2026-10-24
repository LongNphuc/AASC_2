import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AppConfig } from '../config/app-config';
import {
  classifyTiktokCode,
  TiktokEventsClient,
} from './clients/tiktok-events.client';

/** Máy chủ TikTok giả: trả theo `reply` hiện tại, ghi lại header đã nhận. */
describe('TiktokEventsClient', () => {
  let server: Server;
  let baseUrl: string;
  let reply: { status: number; body: string; delayMs?: number };
  let received: { token?: string; path?: string } = {};

  const client = (
    overrides: Partial<AppConfig['tiktok']> = {},
    timeoutMs = 1000,
  ) =>
    new TiktokEventsClient({
      httpTimeoutMs: timeoutMs,
      tiktok: {
        apiBaseUrl: baseUrl,
        accessToken: 'tok',
        crmEventSetId: 'set',
        ...overrides,
      },
    } as AppConfig);

  beforeAll(async () => {
    server = createServer((req, res) => {
      received = {
        token: req.headers['access-token'] as string,
        path: req.url,
      };
      setTimeout(
        () =>
          res
            .writeHead(reply.status, { 'content-type': 'application/json' })
            .end(reply.body),
        reply.delayMs ?? 0,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('thành công: gửi Access-Token tới /open_api/v1.3/event/track/', async () => {
    reply = {
      status: 200,
      body: JSON.stringify({ code: 0, message: 'OK', request_id: 'r1' }),
    };
    expect(await client().track({ a: 1 })).toEqual({ requestId: 'r1' });
    expect(received).toEqual({
      token: 'tok',
      path: '/open_api/v1.3/event/track/',
    });
  });

  it.each([
    [200, { code: 40100 }, 'RATE_LIMIT'],
    [200, { code: 40001 }, 'AUTH'],
    [200, { code: 50002 }, 'SERVER'],
    [200, { code: 40002, message: 'invalid' }, 'BAD_REQUEST'],
    [500, {}, 'SERVER'],
    [429, {}, 'RATE_LIMIT'],
    [400, {}, 'INVALID_RESPONSE'],
    [200, { message: 'không có code' }, 'INVALID_RESPONSE'],
  ])('HTTP %d %j → %s', async (status, body, kind) => {
    reply = { status, body: JSON.stringify(body) };
    await expect(client().track({})).rejects.toMatchObject({
      service: 'tiktok',
      kind,
    });
  });

  it('chưa cấu hình access token: CONFIG; timeout, không kết nối được: TIMEOUT, NETWORK', async () => {
    await expect(client({ accessToken: '' }).track({})).rejects.toMatchObject({
      kind: 'CONFIG',
    });
    reply = { status: 200, body: '{"code":0}', delayMs: 300 };
    await expect(client({}, 50).track({})).rejects.toMatchObject({
      kind: 'TIMEOUT',
    });
    await expect(
      client({ apiBaseUrl: 'http://127.0.0.1:1' }).track({}),
    ).rejects.toMatchObject({ kind: 'NETWORK' });
  });

  it('classifyTiktokCode', () => {
    expect(classifyTiktokCode(40016)).toBe('RATE_LIMIT');
    expect(classifyTiktokCode(40105)).toBe('AUTH');
  });
});
