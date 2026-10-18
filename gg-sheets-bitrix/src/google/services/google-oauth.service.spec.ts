import { OAuth2Client } from 'google-auth-library';
import type { AppConfig } from '../../config/app-config';
import type { GoogleAuthService } from './google-auth.service';
import { GoogleOAuthService } from './google-oauth.service';

const oauthConfig = {
  google: {
    authMode: 'oauth',
    oauthClientId: 'cid',
    oauthClientSecret: 'secret',
    oauthRedirectUri: 'http://localhost:3000/google/oauth/callback',
  },
} as AppConfig;

const auth = { saveOAuthLogin: jest.fn().mockResolvedValue(undefined) };

function service(config: AppConfig = oauthConfig) {
  return new GoogleOAuthService(config, auth as unknown as GoogleAuthService);
}

afterEach(() => jest.restoreAllMocks());

describe('GoogleOAuthService', () => {
  it('URL đăng nhập: xin quyền Sheets, offline, kèm state; hết hạn sau 10 phút', () => {
    const now = Date.parse('2026-10-15T03:00:00Z');
    const { url, expiresAt } = service().createAuthUrl(now);
    const params = new URL(url).searchParams;
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('scope')).toContain(
      'https://www.googleapis.com/auth/spreadsheets',
    );
    expect(params.get('state')).toMatch(/^[0-9a-f]{48}$/);
    expect(expiresAt).toBe('2026-10-15T03:10:00.000Z');
  });

  it('callback: state sai, đã dùng hoặc hết hạn → 400 (20008)', async () => {
    const svc = service();
    const now = Date.parse('2026-10-15T03:00:00Z');
    const state = new URL(svc.createAuthUrl(now).url).searchParams.get(
      'state',
    )!;
    await expect(svc.handleCallback('code', 'sai', now)).rejects.toMatchObject({
      errorKbn: 20008,
    });
    await expect(
      svc.handleCallback('code', state, now + 11 * 60_000),
    ).rejects.toMatchObject({ errorKbn: 20008 });
    await expect(svc.handleCallback('code', state, now)).rejects.toMatchObject({
      errorKbn: 20008,
    });
  });

  it('callback hợp lệ: lưu refresh token và access token đầu tiên vào google_auth', async () => {
    const expiry = Date.parse('2026-10-15T04:00:00Z');
    const getToken = jest.spyOn(
      OAuth2Client.prototype,
      'getToken',
    ) as unknown as jest.Mock;
    getToken.mockResolvedValue({
      tokens: {
        refresh_token: 'refresh',
        access_token: 'access',
        expiry_date: expiry,
        id_token: 'id',
      },
      res: null,
    });
    const verifyIdToken = jest.spyOn(
      OAuth2Client.prototype,
      'verifyIdToken',
    ) as unknown as jest.Mock;
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'me@gmail.com' }),
    });
    const svc = service();
    const now = Date.parse('2026-10-15T03:00:00Z');
    const state = new URL(svc.createAuthUrl(now).url).searchParams.get(
      'state',
    )!;
    expect(await svc.handleCallback('code', state, now)).toBe('me@gmail.com');
    expect(auth.saveOAuthLogin).toHaveBeenCalledWith({
      accountEmail: 'me@gmail.com',
      refreshToken: 'refresh',
      accessToken: 'access',
      expiresAt: new Date(expiry),
    });
  });

  it('chế độ service_account thì không dùng đăng nhập Google; thiếu client thì báo cấu hình', () => {
    expect(() =>
      service({
        google: { authMode: 'service_account' },
      } as AppConfig).createAuthUrl(),
    ).toThrow('GOOGLE_AUTH_MODE=oauth');
    expect(() =>
      service({ google: { authMode: 'oauth' } } as AppConfig).createAuthUrl(),
    ).toThrow('GOOGLE_OAUTH_CLIENT_ID');
  });
});
