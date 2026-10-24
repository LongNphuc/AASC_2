/** Cấu hình process mock: chỉ vài biến, không cần DB hay Redis. */
export interface MockConfig {
  port: number;
  /** Địa chỉ webhook đi: mock gọi về khi deal đổi stage (ONCRMDEALUPDATE). */
  appWebhookUrl: string;
  /** application_token gửi kèm webhook đi, khớp BITRIX24_OUTBOUND_TOKEN của ứng dụng. */
  outboundToken: string;
}

export const MOCK_CONFIG = Symbol('MOCK_CONFIG');

export function mockConfigFromEnv(env = process.env): MockConfig {
  return {
    port: Number(env.MOCK_PORT || 4000),
    appWebhookUrl:
      env.MOCK_APP_WEBHOOK_URL ||
      'http://localhost:3000/webhooks/bitrix24/deals',
    outboundToken: env.BITRIX24_OUTBOUND_TOKEN || '',
  };
}
