import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/** Cổng của Bitrix24/TikTok giả chạy trong process test. */
export const MOCK_PORT = 4999;

/**
 * Biến môi trường của integration và E2E test: .env.test nếu có, không thì
 * .env.test.example (trỏ tới db-test cổng 5433, redis-test cổng 6380).
 */
export function testEnv(): Record<string, string> {
  const file = existsSync('.env.test') ? '.env.test' : '.env.test.example';
  const values = parseEnv(readFileSync(file, 'utf8')) as Record<string, string>;
  return {
    ...values,
    NODE_ENV: 'test',
    TIKTOK_API_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
    BITRIX24_WEBHOOK_URL: `http://127.0.0.1:${MOCK_PORT}/rest/1/testtoken`,
    LOG_DIR: values.LOG_DIR ?? 'logs/test',
  };
}
