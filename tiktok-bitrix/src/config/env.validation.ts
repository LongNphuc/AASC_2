import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import { ERROR } from '../common/constants/messages.constant';

/** Thư mục log mặc định; main.ts dùng để mở tệp log trước khi đọc cấu hình. */
export const DEFAULT_LOG_DIR = 'logs';

const toBoolean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? ['true', '1', 'yes'].includes(value) : value;

/**
 * Biến môi trường của process api và worker (readme_run.md bước 2). Thiếu
 * biến bắt buộc hoặc sai kiểu thì process không khởi động và báo tên biến.
 */
export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsOptional()
  @IsString()
  API_KEY?: string;

  @IsString()
  APP_TIMEZONE: string = 'Asia/Ho_Chi_Minh';

  @IsString()
  DATABASE_URL: string;

  @Transform(toBoolean)
  @IsBoolean()
  DB_MIGRATIONS_RUN: boolean = true;

  @IsString()
  REDIS_URL: string;

  @IsString()
  TIKTOK_WEBHOOK_SECRET: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  TIKTOK_SIGNATURE_TOLERANCE_SECONDS: number = 300;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  FORM_COMPLETE_WINDOW_HOURS: number = 24;

  @IsUrl({ require_tld: false })
  TIKTOK_API_BASE_URL: string;

  @IsOptional()
  @IsString()
  TIKTOK_ACCESS_TOKEN?: string;

  @IsOptional()
  @IsString()
  TIKTOK_CRM_EVENT_SET_ID?: string;

  @IsString()
  TIKTOK_EVENT_DEAL_CREATED: string = 'lead_qualified';

  @IsString()
  TIKTOK_EVENT_DEAL_WON: string = 'deal_won';

  @IsUrl({ require_tld: false })
  BITRIX24_WEBHOOK_URL: string;

  /** Mã xác thực (application_token) của webhook đi Bitrix24 gọi vào /webhooks/bitrix24/deals. */
  @IsOptional()
  @IsString()
  BITRIX24_OUTBOUND_TOKEN?: string;

  @Type(() => Number)
  @Min(0.1)
  BITRIX24_MAX_RPS: number = 2;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  BITRIX24_BURST: number = 10;

  @IsString()
  BITRIX24_LEAD_SOURCE_ID: string = 'TIKTOK';

  @IsString()
  BITRIX24_SOURCES_FIELD: string = 'UF_CRM_SOURCES';

  @IsString()
  PHONE_DEFAULT_REGION: string = 'VN';

  @IsString()
  DEFAULT_CURRENCY: string = 'VND';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  JOB_ATTEMPTS: number = 4;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  JOB_BACKOFF_MS: number = 2000;

  @IsString()
  RECOVERY_CRON: string = '*/10 * * * *';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  RECOVERY_MAX_ROUNDS: number = 3;

  @IsString()
  REPORT_DAILY_CRON: string = '0 8 * * *';

  @IsString()
  ALERT_CHECK_CRON: string = '*/15 * * * *';

  @IsString()
  NOTIFY_ADMIN_USER_IDS: string = '1';

  @IsString()
  NOTIFY_HOT_LEAD_USER_IDS: string = '1';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  HOT_LEAD_SCORE: number = 80;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  WORKER_HEARTBEAT_SECONDS: number = 10;

  @Type(() => Number)
  @IsInt()
  @Min(2)
  WORKER_STALE_SECONDS: number = 30;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_API_LIMIT: number = 100;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_EXPORT_LIMIT: number = 5;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_WEBHOOK_LIMIT: number = 600;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_TTL_SECONDS: number = 60;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  CACHE_TTL_CONFIG_SECONDS: number = 300;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  CACHE_TTL_ANALYTICS_SECONDS: number = 30;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  HTTP_TIMEOUT_MS: number = 15000;

  @IsString()
  LOG_DIR: string = DEFAULT_LOG_DIR;

  @IsIn(['error', 'warn', 'info', 'debug'])
  LOG_LEVEL: string = 'info';
}

/**
 * Validate cấu hình. Dòng `KEY=` trong .env cho ra chuỗi rỗng, nên đổi chuỗi
 * rỗng thành undefined trước để giá trị mặc định hoạt động đúng.
 */
export function validateEnv(
  raw: Record<string, unknown>,
): EnvironmentVariables {
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== ''),
  );
  const env = plainToInstance(EnvironmentVariables, cleaned);
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('; ');
    throw new Error(ERROR.SYSTEM.INVALID_ENV(details));
  }
  return env;
}
