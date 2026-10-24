import type { Request } from 'express';
import { ERROR } from '../../common/constants/messages.constant';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { maskSecrets } from '../../common/logging/redact';

/** Body TikTok tối thiểu mà api kiểm; kiểm đầy đủ ở worker (readme_design.md mục 4.2). */
export type TiktokWebhookBody = Record<string, unknown> & { event_id: string };

/** JSON, là object, có event_id (chuỗi, tối đa 255): sai thì 400 (20001), không lưu. */
export function parseTiktokBody(raw: Buffer): TiktokWebhookBody {
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    throw badRequest(ERROR.WEBHOOK.BODY_NOT_JSON);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw badRequest(ERROR.WEBHOOK.BODY_NOT_JSON);
  }
  const eventId = (payload as { event_id?: unknown }).event_id;
  if (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 255) {
    throw badRequest(ERROR.WEBHOOK.EVENT_ID_MISSING);
  }
  return payload as TiktokWebhookBody;
}

const KEPT_HEADERS = [
  'user-agent',
  'x-forwarded-for',
  'content-type',
  'tiktok-signature',
];

/** Vài header để debug, đã che chữ ký (webhook_events.headers). */
export function pickHeaders(request: Request): Record<string, string> {
  return Object.fromEntries(
    KEPT_HEADERS.flatMap((name) => {
      const value = request.header(name);
      return value ? [[name, maskSecrets(value)]] : [];
    }),
  );
}

/** Body webhook Bitrix24 đã bỏ application_token trước khi lưu. */
export function withoutBitrixToken(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const auth = body.auth as Record<string, unknown> | undefined;
  if (!auth || typeof auth !== 'object') return body;
  return { ...body, auth: { ...auth, application_token: '***' } };
}

function badRequest(message: string): KbnHttpException {
  return new KbnHttpException(400, ErrorKbn.VALIDATION, 'BAD_REQUEST', message);
}
