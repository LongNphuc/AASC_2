import { appConfig, findMissingSettings } from './app-config';
import { validateEnv } from './env.validation';

describe('cấu hình', () => {
  it('chuỗi rỗng trong .env dùng giá trị mặc định', () => {
    const env = validateEnv({ SYNC_INTERVAL_SECONDS: '', PORT: '3001' });
    expect(env.SYNC_INTERVAL_SECONDS).toBe(900);
    expect(env.PORT).toBe(3001);
  });

  it('giá trị sai thì báo tên biến', () => {
    expect(() => validateEnv({ GOOGLE_AUTH_MODE: 'abc' })).toThrow(
      /GOOGLE_AUTH_MODE/,
    );
    expect(() => validateEnv({ SYNC_INTERVAL_SECONDS: '10' })).toThrow(
      /SYNC_INTERVAL_SECONDS/,
    );
  });

  it('liệt kê biến còn thiếu; chế độ oauth thì cần thêm client id/secret', () => {
    const saved = process.env;
    process.env = { GOOGLE_AUTH_MODE: 'oauth', API_KEY: 'k' };
    try {
      const missing = findMissingSettings(appConfig());
      expect(missing).toEqual([
        'GOOGLE_SPREADSHEET_ID',
        'GOOGLE_SHEET_NAME',
        'BITRIX24_WEBHOOK_URL',
        'GOOGLE_OAUTH_CLIENT_ID',
        'GOOGLE_OAUTH_CLIENT_SECRET',
      ]);
    } finally {
      process.env = saved;
    }
  });
});
