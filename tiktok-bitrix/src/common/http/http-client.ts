import { ERROR } from '../constants/messages.constant';
import {
  ExternalApiError,
  type ExternalService,
} from '../errors/external-api.error';

export interface HttpResult {
  status: number;
  /** Body đã parse JSON; null nếu body rỗng hoặc không phải JSON. */
  body: unknown;
}

/**
 * Gửi một request bằng fetch có timeout. Lỗi tầng mạng (chưa nhận được phản
 * hồi) đổi thành ExternalApiError TIMEOUT / NETWORK; có phản hồi thì trả về
 * để lớp gọi tự đọc mã lỗi của dịch vụ. Không thử lại: thử lại ở tầng job.
 */
export async function httpRequest(
  service: ExternalService,
  operation: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<HttpResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw toTransportError(error, service, operation);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw toTransportError(error, service, operation);
  }
  return { status: response.status, body: parseJson(text) };
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toTransportError(
  error: unknown,
  service: ExternalService,
  operation: string,
): ExternalApiError {
  // Đọc name thay vì kiểm instanceof Error: DOMException của fetch có thể đến
  // từ realm khác (vm của Jest) và khi đó instanceof trả false.
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new ExternalApiError(
      service,
      'TIMEOUT',
      ERROR.EXTERNAL.TIMEOUT(service, operation),
      { operation },
    );
  }
  const cause = (error as { cause?: { code?: string } })?.cause;
  return new ExternalApiError(
    service,
    'NETWORK',
    ERROR.EXTERNAL.NETWORK(service, operation, cause?.code),
    { operation },
  );
}
