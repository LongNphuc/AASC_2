import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GoogleAuth as GoogleAuthClient,
  OAuth2Client,
} from 'google-auth-library';
import { Repository } from 'typeorm';
import { ERROR, LOG, WARN } from '../../common/constants/messages.constant';
import {
  ExternalApiError,
  ExternalErrorKind,
} from '../../common/errors/external-api.error';
import { withRetry } from '../../common/http/retry';
import { errorKbnOf } from '../../common/kbn/error.kbn';
import { StatusKbn } from '../../common/kbn/status.kbn';
import { LogService, ServiceLogger } from '../../common/logging/service-logger';
import { appConfig, type AppConfig } from '../../config/app-config';
import { GoogleAuth } from '../entities/google-auth.entity';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/** Token còn dưới 60 giây coi như đã hết hạn, để lệnh gọi không hết hạn giữa chừng. */
export const EXPIRY_MARGIN_MS = 60_000;

/** Google cấp access token sống 1 giờ; dùng khi phản hồi không kèm thời điểm hết hạn. */
const DEFAULT_TOKEN_LIFETIME_MS = 3600_000;

export interface GoogleTokenInfo {
  accountEmail: string | null;
  expiresAt: Date;
}

export interface GoogleTokenStatus {
  accountEmail: string | null;
  expiresAt: Date | null;
  refreshedAt: Date | null;
  valid: boolean;
}

interface FetchedToken extends GoogleTokenInfo {
  token: string;
}

/**
 * Access token Google cho Sheets API, lưu trong bảng google_auth:
 * - refresh(): xin token mới từ Google (service account: ký JWT bằng tệp khóa;
 *   oauth: dùng refresh token của tài khoản đã đăng nhập) rồi lưu xuống DB.
 *   Chỉ batch "Làm mới token Google" gọi (mặc định 30 phút một lần).
 * - getAccessToken(): đọc token từ DB cho mỗi lệnh gọi Sheets API, không gọi
 *   Google. Chưa có hoặc đã hết hạn thì báo lỗi rõ ràng, không tự làm mới, nên
 *   lỗi xác thực Google nằm ở batch token chứ không lẫn vào lần chạy đồng bộ.
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new ServiceLogger(
    LogService.GOOGLE,
    GoogleAuthService.name,
  );

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfig,
    @InjectRepository(GoogleAuth)
    private readonly repo: Repository<GoogleAuth>,
  ) {}

  async getAccessToken(now = Date.now()): Promise<string> {
    const row = await this.current();
    if (!row?.accessToken || !row.expiresAt) {
      const notLoggedIn =
        this.config.google.authMode === 'oauth' && !row?.refreshToken;
      throw new ExternalApiError(
        'google-auth',
        'NOT_CONNECTED',
        notLoggedIn ? ERROR.GOOGLE.NOT_CONNECTED : ERROR.GOOGLE.TOKEN_MISSING,
      );
    }
    if (row.expiresAt.getTime() - now <= EXPIRY_MARGIN_MS) {
      throw new ExternalApiError(
        'google-auth',
        'TOKEN_EXPIRED',
        ERROR.GOOGLE.TOKEN_EXPIRED(row.expiresAt.toISOString()),
      );
    }
    return row.accessToken;
  }

  /** Xin access token mới từ Google và lưu xuống DB (batch làm mới token). */
  async refresh(): Promise<GoogleTokenInfo> {
    const mode = this.config.google.authMode;
    const startedAt = Date.now();
    try {
      const fetched = await withRetry(
        () =>
          mode === 'oauth'
            ? this.fetchOAuthToken()
            : this.fetchServiceAccountToken(),
        this.config.retry,
        {
          onRetry: (_error, attempt, delayMs) =>
            this.logger.warn(
              WARN.EXTERNAL.RETRY('token refresh', attempt, delayMs),
            ),
        },
      );
      const existing = await this.repo.findOneBy({ authMode: mode });
      await this.repo.save({
        ...existing,
        authMode: mode,
        accountEmail: fetched.accountEmail ?? existing?.accountEmail ?? null,
        accessToken: fetched.token,
        expiresAt: fetched.expiresAt,
        refreshedAt: new Date(),
      });
      this.logger.record({
        method: LOG.GOOGLE.TOKEN_REFRESHED(
          fetched.accountEmail ?? '-',
          fetched.expiresAt.toISOString(),
        ),
        statusKbn: StatusKbn.SUCCESS,
        durationMs: Date.now() - startedAt,
      });
      return {
        accountEmail: fetched.accountEmail,
        expiresAt: fetched.expiresAt,
      };
    } catch (error) {
      this.logger.record({
        method: 'token refresh',
        statusKbn: StatusKbn.FAILED,
        errorKbn: errorKbnOf(error),
        durationMs: Date.now() - startedAt,
        errorDetail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Lưu kết quả đăng nhập OAuth: refresh token và access token đầu tiên. */
  async saveOAuthLogin(login: {
    accountEmail: string;
    refreshToken: string;
    accessToken?: string | null;
    expiresAt?: Date | null;
  }): Promise<void> {
    const existing = await this.repo.findOneBy({ authMode: 'oauth' });
    await this.repo.save({
      ...existing,
      authMode: 'oauth',
      accountEmail: login.accountEmail,
      refreshToken: login.refreshToken,
      accessToken: login.accessToken ?? null,
      expiresAt: login.expiresAt ?? null,
      refreshedAt: login.accessToken ? new Date() : null,
    });
  }

  /** Google trả 401 với token đang lưu: đánh dấu hết hạn để các lệnh sau báo lỗi ngay. */
  async markRejected(now = new Date()): Promise<void> {
    await this.repo.update(
      { authMode: this.config.google.authMode },
      { expiresAt: now },
    );
  }

  /** Cần làm mới không: chưa có token, hoặc token còn dưới `withinMs`. */
  async needsRefresh(withinMs: number, now = Date.now()): Promise<boolean> {
    const row = await this.current();
    return (
      !row?.accessToken ||
      !row.expiresAt ||
      row.expiresAt.getTime() - now < withinMs
    );
  }

  async tokenStatus(now = Date.now()): Promise<GoogleTokenStatus> {
    const row = await this.current();
    return {
      accountEmail: row?.accountEmail ?? null,
      expiresAt: row?.expiresAt ?? null,
      refreshedAt: row?.refreshedAt ?? null,
      valid:
        !!row?.accessToken &&
        !!row.expiresAt &&
        row.expiresAt.getTime() - now > EXPIRY_MARGIN_MS,
    };
  }

  /** Email của service account hoặc của tài khoản đã đăng nhập; undefined nếu chưa biết. */
  async accountEmail(): Promise<string | undefined> {
    const stored = (await this.current())?.accountEmail;
    if (stored || this.config.google.authMode === 'oauth') {
      return stored ?? undefined;
    }
    try {
      const credentials = await this.serviceAccountClient().getCredentials();
      return credentials.client_email ?? undefined;
    } catch {
      return undefined;
    }
  }

  private current(): Promise<GoogleAuth | null> {
    return this.repo.findOneBy({ authMode: this.config.google.authMode });
  }

  private serviceAccountClient(): GoogleAuthClient {
    return new GoogleAuthClient({
      keyFile: this.config.google.serviceAccountFile,
      scopes: [SHEETS_SCOPE],
    });
  }

  private async fetchServiceAccountToken(): Promise<FetchedToken> {
    const auth = this.serviceAccountClient();
    const file = this.config.google.serviceAccountFile;
    try {
      // Client mới mỗi lần nên không dùng token cũ đang giữ trong bộ nhớ.
      const client = await auth.getClient();
      const { token } = await client.getAccessToken();
      if (!token) throw new Error('empty access token');
      const email = (await auth.getCredentials()).client_email ?? null;
      return {
        token,
        accountEmail: email,
        expiresAt: expiryOf(client.credentials.expiry_date),
      };
    } catch (error) {
      const reason = messageOf(error);
      if (/ENOENT|no such file|Unexpected token|JSON|EISDIR/i.test(reason)) {
        throw new ExternalApiError(
          'google-auth',
          'CONFIG',
          ERROR.GOOGLE.KEY_FILE_UNREADABLE(file, reason),
          { operation: 'service account token' },
        );
      }
      throw toTokenError(
        error,
        'service account token',
        ERROR.GOOGLE.SERVICE_ACCOUNT_REJECTED(reason),
      );
    }
  }

  private async fetchOAuthToken(): Promise<FetchedToken> {
    const { oauthClientId, oauthClientSecret, oauthRedirectUri } =
      this.config.google;
    if (!oauthClientId || !oauthClientSecret) {
      throw new ExternalApiError(
        'google-auth',
        'CONFIG',
        ERROR.GOOGLE.OAUTH_NOT_CONFIGURED,
      );
    }
    const row = await this.repo.findOneBy({ authMode: 'oauth' });
    if (!row?.refreshToken) {
      throw new ExternalApiError(
        'google-auth',
        'NOT_CONNECTED',
        ERROR.GOOGLE.NOT_CONNECTED,
      );
    }
    const client = new OAuth2Client(
      oauthClientId,
      oauthClientSecret,
      oauthRedirectUri,
    );
    client.setCredentials({ refresh_token: row.refreshToken });
    try {
      const { token } = await client.getAccessToken();
      if (!token) throw new Error('empty access token');
      return {
        token,
        accountEmail: row.accountEmail,
        expiresAt: expiryOf(client.credentials.expiry_date),
      };
    } catch (error) {
      if (/invalid_grant/i.test(messageOf(error))) {
        throw new ExternalApiError(
          'google-auth',
          'RECONNECT_REQUIRED',
          ERROR.GOOGLE.RECONNECT_REQUIRED,
          { operation: 'oauth refresh', upstreamCode: 'invalid_grant' },
        );
      }
      throw toTokenError(error, 'oauth refresh', messageOf(error));
    }
  }
}

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNABORTED',
]);

/**
 * Lỗi khi xin token: mất mạng, timeout, Google quá tải hoặc lỗi 5xx là lỗi tạm
 * thời (được thử lại); còn lại là lỗi xác thực.
 */
function toTokenError(
  error: unknown,
  operation: string,
  authMessage: string,
): ExternalApiError {
  if (error instanceof ExternalApiError) return error;
  const { code, response } = (error ?? {}) as {
    code?: string;
    response?: { status?: number };
  };
  const status = response?.status;
  let kind: ExternalErrorKind = 'AUTH';
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') kind = 'TIMEOUT';
  else if (code && NETWORK_CODES.has(code)) kind = 'NETWORK';
  else if (status === 429) kind = 'RATE_LIMIT';
  else if (status !== undefined && status >= 500) kind = 'SERVER';
  return new ExternalApiError(
    'google-auth',
    kind,
    kind === 'AUTH' ? authMessage : messageOf(error),
    { operation, upstreamStatus: status, upstreamCode: code },
  );
}

function expiryOf(expiryDate: number | null | undefined): Date {
  return new Date(expiryDate ?? Date.now() + DEFAULT_TOKEN_LIFETIME_MS);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
