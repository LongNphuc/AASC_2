import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { randomBytes } from 'node:crypto';
import { ERROR } from '../../common/constants/messages.constant';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { appConfig, type AppConfig } from '../../config/app-config';
import { GoogleAuthService, SHEETS_SCOPE } from './google-auth.service';

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Luồng đăng nhập Google (chế độ oauth):
 * 1. createAuthUrl: cấp `state` ngẫu nhiên (dùng một lần, hết hạn sau 10 phút) và URL đăng nhập.
 * 2. Người dùng đăng nhập, Google chuyển về /google/oauth/callback kèm `code`, `state`.
 * 3. handleCallback: kiểm tra state, đổi code lấy refresh token và access token đầu tiên,
 *    lưu vào bảng google_auth. Sau đó batch "Làm mới token Google" dùng refresh token này.
 */
@Injectable()
export class GoogleOAuthService {
  private readonly states = new Map<string, number>();

  constructor(
    @Inject(appConfig.KEY) private readonly config: AppConfig,
    private readonly auth: GoogleAuthService,
  ) {}

  createAuthUrl(now = Date.now()): { url: string; expiresAt: string } {
    const client = this.client();
    this.dropExpiredStates(now);
    const state = randomBytes(24).toString('hex');
    this.states.set(state, now + STATE_TTL_MS);
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [SHEETS_SCOPE, 'openid', 'email'],
      state,
    });
    return { url, expiresAt: new Date(now + STATE_TTL_MS).toISOString() };
  }

  /** Trả về email của tài khoản vừa đăng nhập. */
  async handleCallback(
    code: string,
    state: string,
    now = Date.now(),
  ): Promise<string> {
    const expiresAt = this.states.get(state);
    this.states.delete(state);
    if (!code || !expiresAt || expiresAt < now) {
      throw new KbnHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorKbn.OAUTH_STATE_INVALID,
        'OAUTH_STATE_INVALID',
        ERROR.GOOGLE.OAUTH_STATE_INVALID,
      );
    }
    const client = this.client();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new ExternalApiError(
        'google-auth',
        'AUTH',
        ERROR.GOOGLE.OAUTH_NO_REFRESH_TOKEN,
      );
    }
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token ?? '',
      audience: this.config.google.oauthClientId,
    });
    const email = ticket.getPayload()?.email ?? 'unknown';
    await this.auth.saveOAuthLogin({
      accountEmail: email,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    });
    return email;
  }

  private client(): OAuth2Client {
    const { authMode, oauthClientId, oauthClientSecret, oauthRedirectUri } =
      this.config.google;
    if (authMode !== 'oauth') {
      throw new KbnHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorKbn.CONFIG,
        'OAUTH_MODE_REQUIRED',
        ERROR.GOOGLE.OAUTH_MODE_REQUIRED,
      );
    }
    if (!oauthClientId || !oauthClientSecret) {
      throw new ExternalApiError(
        'google-auth',
        'CONFIG',
        ERROR.GOOGLE.OAUTH_NOT_CONFIGURED,
      );
    }
    return new OAuth2Client(oauthClientId, oauthClientSecret, oauthRedirectUri);
  }

  private dropExpiredStates(now: number): void {
    for (const [state, expiresAt] of this.states) {
      if (expiresAt < now) this.states.delete(state);
    }
  }
}
