import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.validation';

/**
 * Cấu hình đã validate, gom theo nhóm để các service chỉ đọc phần mình cần.
 * Dùng: `@Inject(appConfig.KEY) private readonly config: AppConfig`.
 */
export const appConfig = registerAs('app', () => {
  const env = validateEnv(process.env);
  return {
    env: env.NODE_ENV,
    port: env.PORT,
    apiKey: env.API_KEY,
    timezone: env.APP_TIMEZONE,
    databaseUrl: env.DATABASE_URL,
    migrationsRun: env.DB_MIGRATIONS_RUN,
    redisUrl: env.REDIS_URL,
    httpTimeoutMs: env.HTTP_TIMEOUT_MS,
    logDir: env.LOG_DIR,
    logLevel: env.LOG_LEVEL,
    tiktok: {
      webhookSecret: env.TIKTOK_WEBHOOK_SECRET,
      signatureToleranceSeconds: env.TIKTOK_SIGNATURE_TOLERANCE_SECONDS,
      formCompleteWindowHours: env.FORM_COMPLETE_WINDOW_HOURS,
      apiBaseUrl: env.TIKTOK_API_BASE_URL.replace(/\/+$/, ''),
      accessToken: env.TIKTOK_ACCESS_TOKEN,
      crmEventSetId: env.TIKTOK_CRM_EVENT_SET_ID,
      eventDealCreated: env.TIKTOK_EVENT_DEAL_CREATED,
      eventDealWon: env.TIKTOK_EVENT_DEAL_WON,
    },
    bitrix: {
      webhookUrl: env.BITRIX24_WEBHOOK_URL.replace(/\/+$/, ''),
      outboundToken: env.BITRIX24_OUTBOUND_TOKEN,
      maxRps: env.BITRIX24_MAX_RPS,
      burst: env.BITRIX24_BURST,
      leadSourceId: env.BITRIX24_LEAD_SOURCE_ID,
      sourcesField: env.BITRIX24_SOURCES_FIELD,
    },
    lead: {
      phoneRegion: env.PHONE_DEFAULT_REGION,
      currency: env.DEFAULT_CURRENCY,
      hotLeadScore: env.HOT_LEAD_SCORE,
    },
    queue: {
      attempts: env.JOB_ATTEMPTS,
      backoffMs: env.JOB_BACKOFF_MS,
      recoveryCron: env.RECOVERY_CRON,
      recoveryMaxRounds: env.RECOVERY_MAX_ROUNDS,
      reportDailyCron: env.REPORT_DAILY_CRON,
      alertCheckCron: env.ALERT_CHECK_CRON,
      workerHeartbeatSeconds: env.WORKER_HEARTBEAT_SECONDS,
      workerStaleSeconds: env.WORKER_STALE_SECONDS,
    },
    notify: {
      adminUserIds: parseIds(env.NOTIFY_ADMIN_USER_IDS),
      hotLeadUserIds: parseIds(env.NOTIFY_HOT_LEAD_USER_IDS),
    },
    throttle: {
      apiLimit: env.THROTTLE_API_LIMIT,
      exportLimit: env.THROTTLE_EXPORT_LIMIT,
      webhookLimit: env.THROTTLE_WEBHOOK_LIMIT,
      ttlSeconds: env.THROTTLE_TTL_SECONDS,
    },
    cache: {
      configSeconds: env.CACHE_TTL_CONFIG_SECONDS,
      analyticsSeconds: env.CACHE_TTL_ANALYTICS_SECONDS,
    },
  };
});

export type AppConfig = ReturnType<typeof appConfig>;

/** "1, 7,9" → [1, 7, 9]; bỏ giá trị không phải số nguyên dương. */
export function parseIds(text: string): number[] {
  return text
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}
