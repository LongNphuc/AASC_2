import { logContext } from './request-context';

/** Mã log của một sự kiện: 8 ký tự đầu của uuid hoặc event_id. */
export function logCode(id: string): string {
  return id.slice(0, 8);
}

/**
 * Chạy một job trong ngữ cảnh log của sự kiện: mọi dòng log của job (bước,
 * lệnh gọi Bitrix24, TikTok) mang mã của webhook_event_uuid.
 */
export function runInJobContext<T>(
  webhookEventUuid: string,
  fn: () => Promise<T>,
): Promise<T> {
  return logContext.run(logCode(webhookEventUuid), fn);
}
