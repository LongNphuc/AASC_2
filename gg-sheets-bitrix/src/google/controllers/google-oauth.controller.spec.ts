import type { AppConfig } from '../../config/app-config';
import { ExternalApiError } from '../../common/errors/external-api.error';
import type { SheetsClient } from '../clients/sheets.client';
import type { GoogleAuthService } from '../services/google-auth.service';
import type { GoogleOAuthService } from '../services/google-oauth.service';
import { GoogleOAuthController } from './google-oauth.controller';

const TOKEN_STATUS = {
  accountEmail: 'sa@x',
  expiresAt: new Date('2026-10-18T04:00:00Z'),
  refreshedAt: new Date('2026-10-18T03:00:00Z'),
  valid: true,
};
const TOKEN = {
  valid: true,
  expiresAt: TOKEN_STATUS.expiresAt,
  refreshedAt: TOKEN_STATUS.refreshedAt,
};

function controller(
  google: Partial<AppConfig['google']>,
  getSpreadsheet: jest.Mock,
) {
  const oauth = {
    createAuthUrl: jest.fn().mockReturnValue({ url: 'u' }),
    handleCallback: jest.fn().mockResolvedValue('me@gmail.com'),
  };
  const auth = {
    accountEmail: jest.fn().mockResolvedValue('sa@x'),
    tokenStatus: jest.fn().mockResolvedValue(TOKEN_STATUS),
  };
  const config = {
    google: { authMode: 'service_account', ...google },
  } as AppConfig;
  return new GoogleOAuthController(
    oauth as unknown as GoogleOAuthService,
    auth as unknown as GoogleAuthService,
    { getSpreadsheet } as unknown as SheetsClient,
    config,
  );
}

describe('GoogleOAuthController', () => {
  it('status: đọc được Sheet, có tab hay không', async () => {
    const ctrl = controller(
      { spreadsheetId: 'sid', sheetName: 'Leads' },
      jest
        .fn()
        .mockResolvedValue({ title: 'T', tabs: [{ title: 'leads-template' }] }),
    );
    expect(await ctrl.status()).toEqual({
      mode: 'service_account',
      account: 'sa@x',
      token: TOKEN,
      spreadsheet: { title: 'T', readable: true },
      sheet: { name: 'Leads', found: false },
      tabs: ['leads-template'],
    });
  });

  it('status: lỗi đọc Sheet hoặc thiếu Spreadsheet ID', async () => {
    const failing = controller(
      { spreadsheetId: 'sid' },
      jest
        .fn()
        .mockRejectedValue(
          new ExternalApiError('google-sheets', 'AUTH', 'chưa share'),
        ),
    );
    expect(await failing.status()).toMatchObject({
      spreadsheet: { readable: false },
      errorKbn: 30003,
      error: 'chưa share',
    });
    expect(await controller({}, jest.fn()).status()).toMatchObject({
      error: 'Chưa cấu hình GOOGLE_SPREADSHEET_ID',
    });
  });

  it('URL đăng nhập và callback', async () => {
    const ctrl = controller({}, jest.fn());
    expect(ctrl.createUrl()).toEqual({ url: 'u' });
    expect(await ctrl.callback('code', 'state')).toContain('me@gmail.com');
  });
});
