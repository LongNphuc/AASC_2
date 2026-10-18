import { HttpService } from '@nestjs/axios';
import { AxiosError, AxiosHeaders } from 'axios';
import { of, throwError } from 'rxjs';
import type { AppConfig } from '../../config/app-config';
import { BitrixHttpClient } from './bitrix-http.client';
import { BitrixWebhookClient } from './bitrix-webhook.client';

const config = {
  bitrix: {
    webhookUrl: 'https://portal.bitrix24.vn/rest/1/secret',
    maxRps: 1000,
  },
  retry: { maxRetries: 2, baseDelayMs: 0, maxInlineWaitMs: 10_000 },
} as AppConfig;

function client(post: jest.Mock, cfg: AppConfig = config) {
  const http = { post } as unknown as HttpService;
  return new BitrixWebhookClient(new BitrixHttpClient(http, cfg), cfg);
}
const response = (data: unknown) => of({ status: 200, data });
const httpError = (status: number, data: unknown) =>
  throwError(
    () =>
      new AxiosError('fail', undefined, undefined, undefined, {
        status,
        statusText: '',
        data,
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
  );

describe('BitrixWebhookClient', () => {
  it('call: gọi <webhook>/<method>.json, trả result', async () => {
    const post = jest.fn().mockReturnValue(response({ result: { ID: 5 } }));
    await expect(client(post).call('crm.lead.get', { id: 5 })).resolves.toEqual(
      { ID: 5 },
    );
    expect(post).toHaveBeenCalledWith(
      'https://portal.bitrix24.vn/rest/1/secret/crm.lead.get.json',
      { id: 5 },
    );
  });

  it('callBatch: dựng cmd, halt=0; mỗi lệnh có kết quả hoặc lỗi riêng', async () => {
    const post = jest.fn().mockReturnValue(
      response({
        result: {
          result: { a: 123 },
          result_error: { b: { error: '', error_description: 'Not found' } },
        },
      }),
    );
    const results = await client(post).callBatch({
      a: { method: 'crm.lead.add', params: { fields: { NAME: 'A' } } },
      b: { method: 'crm.lead.update', params: { id: 9, fields: {} } },
    });
    expect(post.mock.calls[0][1]).toEqual({
      halt: 0,
      cmd: { a: 'crm.lead.add?fields[NAME]=A', b: 'crm.lead.update?id=9' },
    });
    expect(results.a).toEqual({ ok: true, result: 123 });
    expect(results.b).toMatchObject({
      ok: false,
      error: { kind: 'NOT_FOUND' },
    });
  });

  it('callBatch: Bitrix24 trả [] khi không có lỗi nào; quá 50 lệnh thì từ chối; 0 lệnh thì không gọi', async () => {
    const post = jest
      .fn()
      .mockReturnValue(
        response({ result: { result: { a: 1 }, result_error: [] } }),
      );
    await expect(
      client(post).callBatch({ a: { method: 'x', params: {} } }),
    ).resolves.toEqual({ a: { ok: true, result: 1 } });
    const many = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [
        `k${i}`,
        { method: 'x', params: {} },
      ]),
    );
    await expect(client(post).callBatch(many)).rejects.toThrow('tối đa 50');
    await expect(client(post).callBatch({})).resolves.toEqual({});
  });

  it('quá tải thì thử lại theo backoff rồi thành công', async () => {
    const post = jest
      .fn()
      .mockReturnValueOnce(httpError(503, { error: 'QUERY_LIMIT_EXCEEDED' }))
      .mockReturnValueOnce(response({ result: true }));
    await expect(client(post).call('crm.lead.update')).resolves.toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('HTTP 200 mà body báo lỗi; sai webhook thì kèm gợi ý; thiếu cấu hình', async () => {
    await expect(
      client(jest.fn().mockReturnValue(response({ error: 'ERROR_CORE' }))).call(
        'x',
      ),
    ).rejects.toMatchObject({ kind: 'BAD_REQUEST' });
    await expect(
      client(
        jest
          .fn()
          .mockReturnValue(httpError(401, { error: 'INVALID_CREDENTIALS' })),
      ).call('x'),
    ).rejects.toThrow(/BITRIX24_WEBHOOK_URL/);
    const noUrl = {
      ...config,
      bitrix: { webhookUrl: undefined, maxRps: 2 },
    } as AppConfig;
    await expect(client(jest.fn(), noUrl).call('x')).rejects.toMatchObject({
      kind: 'CONFIG',
    });
  });

  it('callPage trả cả next để phân trang', async () => {
    const post = jest
      .fn()
      .mockReturnValue(
        response({ result: [{ ID: '1' }], next: 50, total: 60 }),
      );
    await expect(client(post).callPage('user.get')).resolves.toMatchObject({
      next: 50,
      result: [{ ID: '1' }],
    });
  });
});
