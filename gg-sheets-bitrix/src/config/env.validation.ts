import { plainToInstance, Type } from 'class-transformer';
import {
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

/** Thư mục log mặc định; main.ts cũng dùng để mở tệp log trước khi đọc cấu hình. */
export const DEFAULT_LOG_DIR = 'logs';

/** Chu kỳ mặc định của batch Sheet → Bitrix24 (15 phút). */
export const DEFAULT_SYNC_INTERVAL_SECONDS = 900;

/** Hướng đồng bộ: một chiều Sheet → Bitrix24, hoặc hai chiều. */
export const SYNC_DIRECTIONS = ['sheet_to_bitrix', 'both'] as const;
export type SyncDirection = (typeof SYNC_DIRECTIONS)[number];

/**
 * Khai báo các biến môi trường mà ứng dụng đọc. Biến kết nối Google/Bitrix24
 * để tùy chọn: ứng dụng vẫn khởi động khi chưa điền đủ (để xem /docs, /health),
 * và lần chạy đồng bộ báo lỗi rõ biến nào còn thiếu.
 */
export class EnvironmentVariables {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsOptional()
  @IsString()
  API_KEY?: string;

  @IsString()
  DATABASE_URL: string = 'postgres://sync:sync@localhost:5432/gg_sheets_bitrix';

  @IsIn(['service_account', 'oauth'])
  GOOGLE_AUTH_MODE: 'service_account' | 'oauth' = 'service_account';

  @IsString()
  GOOGLE_SERVICE_ACCOUNT_FILE: string = 'secrets/google-service-account.json';

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_SECRET?: string;

  @IsUrl({ require_tld: false })
  GOOGLE_OAUTH_REDIRECT_URI: string =
    'http://localhost:3000/google/oauth/callback';

  @IsOptional()
  @IsString()
  GOOGLE_SPREADSHEET_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_SHEET_NAME?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  BITRIX24_WEBHOOK_URL?: string;

  /** Mã xác thực (application_token) của webhook đi Bitrix24 gọi vào /webhooks/bitrix24. */
  @IsOptional()
  @IsString()
  BITRIX24_OUTBOUND_TOKEN?: string;

  @Type(() => Number)
  @Min(0.1)
  BITRIX24_MAX_RPS: number = 2;

  @IsString()
  MAPPING_FILE: string = 'mapping.json';

  @IsIn(SYNC_DIRECTIONS)
  SYNC_DIRECTION: SyncDirection = 'sheet_to_bitrix';

  @Type(() => Number)
  @IsInt()
  @Min(60)
  SYNC_INTERVAL_SECONDS: number = DEFAULT_SYNC_INTERVAL_SECONDS;

  /** Chu kỳ làm mới token Google; phải ngắn hơn đời token (3600 giây). */
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(3000)
  GOOGLE_TOKEN_REFRESH_SECONDS: number = 1800;

  @IsString()
  SYNC_TIMEZONE: string = 'Asia/Ho_Chi_Minh';

  @Type(() => Number)
  @IsInt()
  @Min(30)
  SYNC_MAX_RUN_SECONDS: number = 600;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  SYNC_HEARTBEAT_SECONDS: number = 30;

  @Type(() => Number)
  @IsInt()
  @Min(30)
  SYNC_STALE_SECONDS: number = 120;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  RETRY_MAX_ATTEMPTS: number = 3;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  RETRY_BASE_DELAY_MS: number = 1000;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  RETRY_MAX_INLINE_WAIT_SECONDS: number = 10;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  PUSH_MAX_CONSECUTIVE_FAILURES: number = 2;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  HTTP_TIMEOUT_MS: number = 30000;

  @IsString()
  LOG_DIR: string = DEFAULT_LOG_DIR;
}

/**
 * Hàm validate cấu hình. Dòng `KEY=` trong .env cho ra chuỗi rỗng, nên đổi
 * chuỗi rỗng thành undefined trước để giá trị mặc định hoạt động đúng.
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
