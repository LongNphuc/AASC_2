import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.validation';

/**
 * Cấu hình đã validate, gom theo nhóm để các service chỉ đọc phần mình cần.
 * Dùng: `@Inject(appConfig.KEY) private readonly config: AppConfig`.
 */
export const appConfig = registerAs('app', () => {
  const env = validateEnv(process.env);
  return {
    port: env.PORT,
    apiKey: env.API_KEY,
    databaseUrl: env.DATABASE_URL,
    httpTimeoutMs: env.HTTP_TIMEOUT_MS,
    logDir: env.LOG_DIR,
    mappingFile: env.MAPPING_FILE,
    google: {
      authMode: env.GOOGLE_AUTH_MODE,
      serviceAccountFile: env.GOOGLE_SERVICE_ACCOUNT_FILE,
      oauthClientId: env.GOOGLE_OAUTH_CLIENT_ID,
      oauthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      oauthRedirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
      spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
      sheetName: env.GOOGLE_SHEET_NAME,
      tokenRefreshSeconds: env.GOOGLE_TOKEN_REFRESH_SECONDS,
      apiBaseUrl: 'https://sheets.googleapis.com/v4/spreadsheets',
    },
    bitrix: {
      webhookUrl: env.BITRIX24_WEBHOOK_URL?.replace(/\/+$/, ''),
      maxRps: env.BITRIX24_MAX_RPS,
      outboundToken: env.BITRIX24_OUTBOUND_TOKEN,
    },
    sync: {
      direction: env.SYNC_DIRECTION,
      intervalSeconds: env.SYNC_INTERVAL_SECONDS,
      timezone: env.SYNC_TIMEZONE,
      maxRunSeconds: env.SYNC_MAX_RUN_SECONDS,
      heartbeatSeconds: env.SYNC_HEARTBEAT_SECONDS,
      staleSeconds: env.SYNC_STALE_SECONDS,
      pushMaxConsecutiveFailures: env.PUSH_MAX_CONSECUTIVE_FAILURES,
    },
    retry: {
      maxRetries: env.RETRY_MAX_ATTEMPTS,
      baseDelayMs: env.RETRY_BASE_DELAY_MS,
      maxInlineWaitMs: env.RETRY_MAX_INLINE_WAIT_SECONDS * 1000,
    },
  };
});

export type AppConfig = ReturnType<typeof appConfig>;

/** Tên các biến cần cho lần chạy đồng bộ mà còn trống, để cảnh báo lúc khởi động. */
export function findMissingSettings(config: AppConfig): string[] {
  const settings: Record<string, unknown> = {
    GOOGLE_SPREADSHEET_ID: config.google.spreadsheetId,
    GOOGLE_SHEET_NAME: config.google.sheetName,
    BITRIX24_WEBHOOK_URL: config.bitrix.webhookUrl,
  };
  if (config.google.authMode === 'oauth') {
    settings.GOOGLE_OAUTH_CLIENT_ID = config.google.oauthClientId;
    settings.GOOGLE_OAUTH_CLIENT_SECRET = config.google.oauthClientSecret;
  }
  if (config.sync.direction === 'both') {
    settings.BITRIX24_OUTBOUND_TOKEN = config.bitrix.outboundToken;
  }
  return Object.keys(settings).filter((name) => !settings[name]);
}
