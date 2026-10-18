import { ExternalApiError } from '../../common/errors/external-api.error';
import { CooldownRequiredError } from '../../common/http/retry';
import { StatusKbn } from '../../common/kbn/status.kbn';
import type { GoogleAuthService } from '../../google/services/google-auth.service';
import { GoogleTokenRefreshService } from './google-token-refresh.service';

function service(refresh: jest.Mock) {
  return new GoogleTokenRefreshService({
    refresh,
  } as unknown as GoogleAuthService);
}

describe('GoogleTokenRefreshService', () => {
  it('làm mới được → SUCCESS, summary ghi tài khoản và thời điểm hết hạn', async () => {
    const expiresAt = new Date('2026-10-18T04:00:00Z');
    const outcome = await service(
      jest.fn().mockResolvedValue({ accountEmail: 'sa@x', expiresAt }),
    ).run();
    expect(outcome).toEqual({
      statusKbn: StatusKbn.SUCCESS,
      summary: { account_email: 'sa@x', expires_at: expiresAt.toISOString() },
      problemRows: null,
    });
  });

  it('lỗi xác thực → FAILED kèm mã lỗi; Google bắt chờ lâu → FAILED với lỗi gốc', async () => {
    const auth = new ExternalApiError(
      'google-auth',
      'RECONNECT_REQUIRED',
      'đăng nhập lại',
    );
    expect(
      await service(jest.fn().mockRejectedValue(auth)).run(),
    ).toMatchObject({
      statusKbn: StatusKbn.FAILED,
      errorKbn: 50005,
      errorDetail: 'đăng nhập lại',
    });
    const limited = new ExternalApiError(
      'google-auth',
      'RATE_LIMIT',
      'quá tải',
    );
    expect(
      await service(
        jest
          .fn()
          .mockRejectedValue(new CooldownRequiredError(limited, new Date())),
      ).run(),
    ).toMatchObject({ statusKbn: StatusKbn.FAILED, errorKbn: 50009 });
  });
});
