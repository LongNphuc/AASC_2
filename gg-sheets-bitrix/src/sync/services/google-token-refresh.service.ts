import { Injectable } from '@nestjs/common';
import { CooldownRequiredError } from '../../common/http/retry';
import { errorKbnOf } from '../../common/kbn/error.kbn';
import { StatusKbn } from '../../common/kbn/status.kbn';
import { GoogleAuthService } from '../../google/services/google-auth.service';
import type { RunOutcome } from '../types/sync.types';

/**
 * Việc của batch "Làm mới token Google": xin access token mới và lưu vào bảng
 * google_auth. Batch Sheet → Bitrix24 chỉ đọc token đó, nên lỗi xác thực Google
 * (sai khóa, refresh token bị thu hồi, mất mạng tới Google) hiện ở lịch sử của
 * batch này, tách khỏi lần chạy đồng bộ.
 */
@Injectable()
export class GoogleTokenRefreshService {
  constructor(private readonly auth: GoogleAuthService) {}

  async run(): Promise<RunOutcome> {
    try {
      const token = await this.auth.refresh();
      return {
        statusKbn: StatusKbn.SUCCESS,
        summary: {
          account_email: token.accountEmail,
          expires_at: token.expiresAt.toISOString(),
        },
        problemRows: null,
      };
    } catch (caught: unknown) {
      const error =
        caught instanceof CooldownRequiredError ? caught.error : caught;
      return {
        statusKbn: StatusKbn.FAILED,
        errorKbn: errorKbnOf(error),
        errorDetail: error instanceof Error ? error.message : String(error),
        summary: null,
        problemRows: null,
      };
    }
  }
}
