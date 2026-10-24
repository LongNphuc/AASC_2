import type request from 'supertest';
import { samplePayload } from '../../src/testing/fixtures';
import {
  signTiktokPayload,
  TIKTOK_SIGNATURE_HEADER,
} from '../../src/webhooks/helpers/tiktok-signature';

type Http = () => ReturnType<typeof request>;

/** Gửi webhook TikTok đã ký (như npm run tiktok:send). */
export function sendTiktok(
  http: Http,
  payload: Record<string, unknown> | string,
  options: { timestamp?: number; secret?: string } = {},
) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const secret = options.secret ?? process.env.TIKTOK_WEBHOOK_SECRET ?? '';
  return http()
    .post('/webhooks/tiktok/leads')
    .set('Content-Type', 'application/json')
    .set(
      TIKTOK_SIGNATURE_HEADER,
      signTiktokPayload(body, secret, options.timestamp),
    )
    .send(body);
}

/** Payload mẫu với event_id và (tùy chọn) dữ liệu khách khác. */
export function leadPayload(
  eventId: string,
  changes: {
    lead_data?: Record<string, unknown>;
    campaign?: Record<string, unknown>;
    event?: string;
    timestamp?: number;
  } = {},
  name = 'lead-generate',
): Record<string, unknown> {
  const payload = samplePayload(name);
  return {
    ...payload,
    event_id: eventId,
    ...(changes.event ? { event: changes.event } : {}),
    ...(changes.timestamp ? { timestamp: changes.timestamp } : {}),
    campaign: { ...(payload.campaign as object), ...changes.campaign },
    lead_data: { ...(payload.lead_data as object), ...changes.lead_data },
  };
}

/** Gửi webhook Bitrix24 (form-urlencoded như Bitrix24 thật). */
export function sendBitrix(
  http: Http,
  dealId: number,
  event = 'ONCRMDEALUPDATE',
  token = process.env.BITRIX24_OUTBOUND_TOKEN,
) {
  return http()
    .post('/webhooks/bitrix24/deals')
    .type('form')
    .send({
      event,
      'data[FIELDS][ID]': String(dealId),
      ts: String(Math.floor(Date.now() / 1000)),
      'auth[application_token]': token ?? '',
    });
}

/** Chờ tới khi `check` trả giá trị khác null/undefined/false (poll mỗi 50 ms). */
export async function waitFor<T>(
  check: () => Promise<T> | T,
  timeoutMs = 10_000,
  label = 'điều kiện',
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await check();
    if (last !== null && last !== undefined && last !== false)
      return last as NonNullable<T>;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Hết ${timeoutMs} ms vẫn chưa đạt ${label} (lần cuối: ${JSON.stringify(last)})`,
  );
}
