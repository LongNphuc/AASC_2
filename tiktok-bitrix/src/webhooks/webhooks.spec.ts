import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ERROR } from '../common/constants/messages.constant';
import { KbnHttpException } from '../common/errors/kbn-http.exception';
import { ErrorKbn } from '../common/kbn/error.kbn';
import type { AppConfig } from '../config/app-config';
import { BitrixTokenGuard } from './guards/bitrix-token.guard';
import { TikTokSignatureGuard } from './guards/tiktok-signature.guard';
import {
  signTiktokPayload,
  verifyTiktokSignature,
} from './helpers/tiktok-signature';
import {
  parseTiktokBody,
  pickHeaders,
  withoutBitrixToken,
} from './helpers/webhook-body';

const SECRET = 'test-tiktok-secret';
const body = Buffer.from('{"event":"lead.generate","event_id":"evt_1"}');
const now = 1_790_000_000;

function context(
  request: Partial<Request> & { headers?: Record<string, string> },
): ExecutionContext {
  const req = {
    ...request,
    header: (name: string) => request.headers?.[name.toLowerCase()],
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function thrown(fn: () => unknown): KbnHttpException {
  try {
    fn();
  } catch (error) {
    if (error instanceof KbnHttpException) return error;
    throw error;
  }
  throw new Error('không ném lỗi');
}

describe('chữ ký TikTok', () => {
  it('ký rồi kiểm lại được, đúng từng byte của raw body', () => {
    const header = signTiktokPayload(body, SECRET, now);
    expect(header).toMatch(/^t=1790000000,s=[0-9a-f]{64}$/);
    expect(verifyTiktokSignature(header, body, SECRET, 300, now)).toEqual({
      ok: true,
    });
    expect(
      verifyTiktokSignature(
        header.toUpperCase().replace('T=', 't=').replace('S=', 's='),
        body,
        SECRET,
        300,
        now,
      ),
    ).toEqual({ ok: true });
    // Cùng JSON nhưng khác khoảng trắng: chữ ký khác.
    expect(
      verifyTiktokSignature(
        header,
        Buffer.from('{"event": "lead.generate","event_id":"evt_1"}'),
        SECRET,
        300,
        now,
      ),
    ).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it.each([
    [undefined, 'missing'],
    ['s=abc', 'format'],
    ['t=abc,s=abc', 'format'],
    ['t=1790000000,s=xyz', 'format'],
    ['t=1790000000', 'format'],
  ])('header %j → %s', (header, reason) => {
    expect(verifyTiktokSignature(header, body, SECRET, 300, now)).toMatchObject(
      { ok: false, reason },
    );
  });

  it('chữ ký cũ hơn ngưỡng: expired kèm độ lệch (E2)', () => {
    const header = signTiktokPayload(body, SECRET, now - 600);
    expect(verifyTiktokSignature(header, body, SECRET, 300, now)).toEqual({
      ok: false,
      reason: 'expired',
      skew: 600,
    });
  });
});

describe('TikTokSignatureGuard', () => {
  const guard = new TikTokSignatureGuard({
    tiktok: { webhookSecret: SECRET, signatureToleranceSeconds: 300 },
  } as AppConfig);

  it('đúng chữ ký: cho qua', () => {
    const headers = { 'tiktok-signature': signTiktokPayload(body, SECRET) };
    expect(guard.canActivate(context({ body, headers }))).toBe(true);
  });

  it('sai chữ ký: 401 20010 (E1); chữ ký cũ: 401 20011 (E2); body không phải Buffer: sai chữ ký', () => {
    const bad = thrown(() =>
      guard.canActivate(
        context({
          body,
          headers: {
            'tiktok-signature': `t=${Math.floor(Date.now() / 1000)},s=00`,
          },
        }),
      ),
    );
    expect(bad.getStatus()).toBe(401);
    expect(bad.errorKbn).toBe(ErrorKbn.SIGNATURE_INVALID);
    expect(bad.getResponse()).toMatchObject({
      message: ERROR.WEBHOOK.SIGNATURE_MISMATCH,
    });

    const old = thrown(() =>
      guard.canActivate(
        context({
          body,
          headers: {
            'tiktok-signature': signTiktokPayload(
              body,
              SECRET,
              Math.floor(Date.now() / 1000) - 600,
            ),
          },
        }),
      ),
    );
    expect(old.errorKbn).toBe(ErrorKbn.SIGNATURE_EXPIRED);

    const parsed = thrown(() =>
      guard.canActivate(
        context({
          body: {},
          headers: { 'tiktok-signature': signTiktokPayload(body, SECRET) },
        }),
      ),
    );
    expect(parsed.errorKbn).toBe(ErrorKbn.SIGNATURE_INVALID);
    expect(
      thrown(() => guard.canActivate(context({ body }))).getResponse(),
    ).toMatchObject({ message: ERROR.WEBHOOK.SIGNATURE_MISSING });
  });
});

describe('BitrixTokenGuard', () => {
  const guard = new BitrixTokenGuard({
    bitrix: { outboundToken: 'tok' },
  } as AppConfig);

  it('đúng token: cho qua; sai hoặc thiếu: 401 20012 (E16)', () => {
    expect(
      guard.canActivate(
        context({ body: { auth: { application_token: 'tok' } } }),
      ),
    ).toBe(true);
    for (const value of [
      { auth: { application_token: 'sai' } },
      { auth: {} },
      undefined,
    ]) {
      const error = thrown(() => guard.canActivate(context({ body: value })));
      expect(error.getStatus()).toBe(401);
      expect(error.errorKbn).toBe(ErrorKbn.BITRIX_TOKEN_INVALID);
    }
  });

  it('chưa đặt BITRIX24_OUTBOUND_TOKEN: 503', () => {
    const unset = new BitrixTokenGuard({
      bitrix: { outboundToken: '' },
    } as AppConfig);
    const error = thrown(() => unset.canActivate(context({ body: {} })));
    expect(error.getStatus()).toBe(503);
    expect(error.errorKbn).toBe(ErrorKbn.CONFIG);
  });
});

describe('webhook-body', () => {
  it('parseTiktokBody: JSON object có event_id', () => {
    expect(parseTiktokBody(body)).toEqual({
      event: 'lead.generate',
      event_id: 'evt_1',
    });
    for (const [raw, message] of [
      ['không phải json', ERROR.WEBHOOK.BODY_NOT_JSON],
      ['[1]', ERROR.WEBHOOK.BODY_NOT_JSON],
      ['null', ERROR.WEBHOOK.BODY_NOT_JSON],
      ['{"event_id":123}', ERROR.WEBHOOK.EVENT_ID_MISSING],
      ['{"event_id":"  "}', ERROR.WEBHOOK.EVENT_ID_MISSING],
      [
        JSON.stringify({ event_id: 'x'.repeat(256) }),
        ERROR.WEBHOOK.EVENT_ID_MISSING,
      ],
    ]) {
      const error = thrown(() => parseTiktokBody(Buffer.from(raw)));
      expect(error.getStatus()).toBe(400);
      expect(error.errorKbn).toBe(ErrorKbn.VALIDATION);
      expect(error.getResponse()).toMatchObject({ message });
    }
  });

  it('pickHeaders giữ vài header, che chữ ký; withoutBitrixToken che token', () => {
    const request = context({
      headers: {
        'user-agent': 'TikTok',
        'tiktok-signature': 't=1,s=0123456789abcdef',
        cookie: 'x',
      },
    })
      .switchToHttp()
      .getRequest<Request>();
    expect(pickHeaders(request)).toEqual({
      'user-agent': 'TikTok',
      'tiktok-signature': 't=1,s=***',
    });
    expect(
      withoutBitrixToken({
        event: 'X',
        auth: { application_token: 'tok', domain: 'd' },
      }),
    ).toEqual({
      event: 'X',
      auth: { application_token: '***', domain: 'd' },
    });
    expect(withoutBitrixToken({ event: 'X' })).toEqual({ event: 'X' });
  });
});
