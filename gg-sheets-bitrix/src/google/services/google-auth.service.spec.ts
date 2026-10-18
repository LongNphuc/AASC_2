import {
  GoogleAuth as GoogleAuthClient,
  OAuth2Client,
} from 'google-auth-library';
import type { Repository } from 'typeorm';
import { errorKbnOf } from '../../common/kbn/error.kbn';
import type { AppConfig } from '../../config/app-config';
import type { GoogleAuth } from '../entities/google-auth.entity';
import { GoogleAuthService } from './google-auth.service';

const NOW = Date.parse('2026-10-18T03:00:00Z');
const IN_ONE_HOUR = NOW + 3600_000;

function setup(
  google: Partial<AppConfig['google']> = {},
  row: Partial<GoogleAuth> | null = null,
) {
  const repo = {
    findOneBy: jest.fn().mockResolvedValue(row),
    save: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    google: {
      authMode: 'service_account',
      serviceAccountFile: 'secrets/none.json',
      ...google,
    },
    retry: { maxRetries: 1, baseDelayMs: 0, maxInlineWaitMs: 10_000 },
  } as AppConfig;
  const service = new GoogleAuthService(
    config,
    repo as unknown as Repository<GoogleAuth>,
  );
  return { service, repo };
}

const OAUTH = {
  authMode: 'oauth',
  oauthClientId: 'id',
  oauthClientSecret: 's',
} as const;

afterEach(() => jest.restoreAllMocks());

describe('GoogleAuthService.getAccessToken (đọc từ DB, không gọi Google)', () => {
  it('token còn hạn → trả token', async () => {
    const { service, repo } = setup(
      {},
      {
        accessToken: 'tok',
        expiresAt: new Date(IN_ONE_HOUR),
      },
    );
    expect(await service.getAccessToken(NOW)).toBe('tok');
    expect(repo.findOneBy).toHaveBeenCalledWith({
      authMode: 'service_account',
    });
  });

  it('chưa có token → 50006, chỉ cách xem batch làm mới token', async () => {
    const error = await setup()
      .service.getAccessToken(NOW)
      .catch((e: unknown) => e);
    expect(errorKbnOf(error)).toBe(50006);
    expect((error as Error).message).toContain('Làm mới token Google');
  });

  it('oauth chưa đăng nhập → 50006 kèm hướng dẫn đăng nhập', async () => {
    const error = await setup(OAUTH)
      .service.getAccessToken(NOW)
      .catch((e: unknown) => e);
    expect(errorKbnOf(error)).toBe(50006);
    expect((error as Error).message).toContain('/google/oauth/url');
  });

  it('token hết hạn hoặc còn dưới 60 giây → 50004, không tự làm mới', async () => {
    const { service } = setup(
      {},
      {
        accessToken: 'tok',
        expiresAt: new Date(NOW + 30_000),
      },
    );
    const error = await service.getAccessToken(NOW).catch((e: unknown) => e);
    expect(errorKbnOf(error)).toBe(50004);
  });
});

describe('GoogleAuthService.refresh (batch làm mới token)', () => {
  it('service account: xin token mới, lưu access token, hạn, email xuống DB', async () => {
    jest.spyOn(GoogleAuthClient.prototype, 'getClient').mockResolvedValue({
      getAccessToken: () => Promise.resolve({ token: 'new-token' }),
      credentials: { expiry_date: IN_ONE_HOUR },
    });
    jest.spyOn(GoogleAuthClient.prototype, 'getCredentials').mockResolvedValue({
      client_email: 'sa@x.iam.gserviceaccount.com',
    } as never);
    const { service, repo } = setup(
      {},
      { uuid: 'u1', authMode: 'service_account' },
    );

    const token = await service.refresh();

    expect(token).toEqual({
      accountEmail: 'sa@x.iam.gserviceaccount.com',
      expiresAt: new Date(IN_ONE_HOUR),
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        uuid: 'u1',
        authMode: 'service_account',
        accessToken: 'new-token',
        expiresAt: new Date(IN_ONE_HOUR),
        accountEmail: 'sa@x.iam.gserviceaccount.com',
      }),
    );
  });

  it('service account: không đọc được tệp khóa → 50012, không lưu gì', async () => {
    const { service, repo } = setup({
      serviceAccountFile: '/không/có/tệp.json',
    });
    const error = await service.refresh().catch((e: unknown) => e);
    expect(errorKbnOf(error)).toBe(50012);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('mất mạng tới Google → thử lại theo backoff rồi báo 50002', async () => {
    const getClient = jest
      .spyOn(GoogleAuthClient.prototype, 'getClient')
      .mockRejectedValue(
        Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      );
    const error = await setup()
      .service.refresh()
      .catch((e: unknown) => e);
    expect(errorKbnOf(error)).toBe(50002);
    expect(getClient).toHaveBeenCalledTimes(2);
  });

  it('Google từ chối khóa service account → 50003 kèm hướng dẫn tạo khóa mới', async () => {
    jest
      .spyOn(GoogleAuthClient.prototype, 'getClient')
      .mockRejectedValue(new Error('invalid_grant: Invalid JWT Signature.'));
    const error = await setup()
      .service.refresh()
      .catch((e: unknown) => e);
    expect(errorKbnOf(error)).toBe(50003);
    expect((error as Error).message).toContain('tạo khóa mới');
  });

  it('oauth: dùng refresh token trong DB; thiếu client → CONFIG; chưa đăng nhập → 50006', async () => {
    const getAccessToken = jest.spyOn(
      OAuth2Client.prototype,
      'getAccessToken',
    ) as unknown as jest.Mock;
    getAccessToken.mockImplementation(function (this: OAuth2Client) {
      this.credentials = { ...this.credentials, expiry_date: IN_ONE_HOUR };
      return Promise.resolve({ token: 'oauth-token' });
    });
    const { service, repo } = setup(OAUTH, {
      uuid: 'u2',
      authMode: 'oauth',
      accountEmail: 'me@gmail.com',
      refreshToken: 'refresh',
    });
    await service.refresh();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshToken: 'refresh',
        accessToken: 'oauth-token',
        accountEmail: 'me@gmail.com',
      }),
    );

    expect(
      errorKbnOf(
        await setup({ authMode: 'oauth' })
          .service.refresh()
          .catch((e: unknown) => e),
      ),
    ).toBe(50012);
    expect(
      errorKbnOf(
        await setup(OAUTH)
          .service.refresh()
          .catch((e: unknown) => e),
      ),
    ).toBe(50006);
  });

  it('oauth: refresh token bị thu hồi (invalid_grant) → 50005, phải đăng nhập lại', async () => {
    jest
      .spyOn(OAuth2Client.prototype, 'getAccessToken')
      .mockRejectedValue(new Error('invalid_grant') as never);
    const { service } = setup(OAUTH, {
      authMode: 'oauth',
      refreshToken: 'old',
    });
    expect(errorKbnOf(await service.refresh().catch((e: unknown) => e))).toBe(
      50005,
    );
  });
});

describe('GoogleAuthService: trạng thái token', () => {
  it('needsRefresh: chưa có token, hoặc còn ít hơn ngưỡng', async () => {
    expect(await setup().service.needsRefresh(1800_000, NOW)).toBe(true);
    const fresh = setup(
      {},
      { accessToken: 't', expiresAt: new Date(IN_ONE_HOUR) },
    );
    expect(await fresh.service.needsRefresh(1800_000, NOW)).toBe(false);
    expect(await fresh.service.needsRefresh(4000_000, NOW)).toBe(true);
  });

  it('tokenStatus, markRejected, saveOAuthLogin', async () => {
    const refreshedAt = new Date(NOW - 60_000);
    const { service, repo } = setup(
      {},
      {
        accountEmail: 'sa@x',
        accessToken: 't',
        expiresAt: new Date(IN_ONE_HOUR),
        refreshedAt,
      },
    );
    expect(await service.tokenStatus(NOW)).toEqual({
      accountEmail: 'sa@x',
      expiresAt: new Date(IN_ONE_HOUR),
      refreshedAt,
      valid: true,
    });

    await service.markRejected(new Date(NOW));
    expect(repo.update).toHaveBeenCalledWith(
      { authMode: 'service_account' },
      { expiresAt: new Date(NOW) },
    );

    await service.saveOAuthLogin({
      accountEmail: 'me@gmail.com',
      refreshToken: 'r',
      accessToken: 'a',
      expiresAt: new Date(IN_ONE_HOUR),
    });
    expect(repo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        authMode: 'oauth',
        accountEmail: 'me@gmail.com',
        refreshToken: 'r',
        accessToken: 'a',
      }),
    );
  });

  it('email tài khoản: lấy từ DB; service account chưa có trong DB thì đọc tệp khóa', async () => {
    expect(
      await setup(OAUTH, {
        accountEmail: 'me@gmail.com',
      }).service.accountEmail(),
    ).toBe('me@gmail.com');
    expect(await setup().service.accountEmail()).toBeUndefined();
  });
});
