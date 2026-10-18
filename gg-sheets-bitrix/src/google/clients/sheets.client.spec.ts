import { HttpService } from '@nestjs/axios';
import { AxiosError, AxiosHeaders } from 'axios';
import { of, throwError } from 'rxjs';
import { ExternalApiError } from '../../common/errors/external-api.error';
import type { AppConfig } from '../../config/app-config';
import type { GoogleAuthService } from '../services/google-auth.service';
import { SheetsClient, toSheetCell } from './sheets.client';

const config = {
  google: {
    apiBaseUrl: 'https://sheets.googleapis.com/v4/spreadsheets',
    authMode: 'service_account',
  },
  retry: { maxRetries: 2, baseDelayMs: 0, maxInlineWaitMs: 10_000 },
} as AppConfig;

function setup(request: jest.Mock) {
  const auth = {
    getAccessToken: jest.fn().mockResolvedValue('tok'),
    markRejected: jest.fn().mockResolvedValue(undefined),
    accountEmail: jest.fn().mockResolvedValue('sa@x.iam.gserviceaccount.com'),
  };
  const client = new SheetsClient(
    { request } as unknown as HttpService,
    auth as unknown as GoogleAuthService,
    config,
  );
  return { client, auth };
}
const ok = (data: unknown) => of({ status: 200, data });
const fail = (status: number, data: unknown = {}) =>
  throwError(
    () =>
      new AxiosError('fail', undefined, undefined, undefined, {
        status,
        statusText: '',
        data,
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
  );

const SPREADSHEET = {
  properties: { title: 'Leads 2026' },
  sheets: [
    {
      properties: {
        sheetId: 7,
        title: 'leads-template',
        gridProperties: { rowCount: 1000, columnCount: 26 },
      },
    },
  ],
};

describe('SheetsClient', () => {
  it('getSpreadsheet: tên và danh sách tab, gửi kèm access token', async () => {
    const request = jest.fn().mockReturnValue(ok(SPREADSHEET));
    const { client } = setup(request);
    expect(await client.getSpreadsheet('sid')).toEqual({
      title: 'Leads 2026',
      tabs: [
        {
          sheetId: 7,
          title: 'leads-template',
          rowCount: 1000,
          columnCount: 26,
        },
      ],
    });
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'GET',
      url: 'https://sheets.googleapis.com/v4/spreadsheets/sid',
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('assertTab: không có tab thì báo lỗi kèm danh sách tab đang có (30014)', async () => {
    const { client } = setup(jest.fn().mockReturnValue(ok(SPREADSHEET)));
    await expect(
      client.assertTab('sid', 'leads-template'),
    ).resolves.toMatchObject({ sheetId: 7 });
    await expect(client.assertTab('sid', 'Leads')).rejects.toMatchObject({
      kind: 'SHEET_NOT_FOUND',
      message:
        "Không tìm thấy tab 'Leads' trong Sheet. Các tab hiện có: leads-template. Kiểm tra GOOGLE_SHEET_NAME trong .env",
    });
  });

  it('readGrid: đọc theo range, trả chữ hiển thị, giá trị thật, định dạng ô', async () => {
    const request = jest.fn().mockReturnValue(
      ok({
        sheets: [
          {
            data: [
              {
                rowData: [
                  { values: [{ formattedValue: 'Ngày' }] },
                  {
                    values: [
                      {
                        formattedValue: '15/10/2026',
                        effectiveValue: { numberValue: 46310 },
                        effectiveFormat: { numberFormat: { type: 'DATE' } },
                      },
                    ],
                  },
                  {},
                ],
              },
            ],
          },
        ],
      }),
    );
    const { client } = setup(request);
    expect(await client.readGrid('sid', "Khách's", '1:1')).toEqual([
      [{ text: 'Ngày', value: undefined, formatType: undefined }],
      [{ text: '15/10/2026', value: 46310, formatType: 'DATE' }],
      [],
    ]);
    expect(request.mock.calls[0][0].params.ranges).toBe("'Khách''s'!1:1");
  });

  it('updateValues và batchUpdate: một lệnh cho nhiều ô; không có gì thì không gọi', async () => {
    const request = jest.fn().mockReturnValue(ok({ totalUpdatedCells: 2 }));
    const { client } = setup(request);
    expect(
      await client.updateValues('sid', [
        { range: 'A1', values: [['x']] },
        { range: 'B1', values: [[1]] },
      ]),
    ).toBe(2);
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      url: expect.stringContaining('/values:batchUpdate'),
      data: { valueInputOption: 'RAW' },
    });
    await client.batchUpdate('sid', [{ appendDimension: {} }]);
    expect(request.mock.calls[1][0].url).toContain(':batchUpdate');
    expect(await client.updateValues('sid', [])).toBe(0);
    await client.batchUpdate('sid', []);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('429 thì thử lại theo backoff rồi thành công', async () => {
    const request = jest
      .fn()
      .mockReturnValueOnce(fail(429))
      .mockReturnValueOnce(ok(SPREADSHEET));
    const { client } = setup(request);
    await expect(client.getSpreadsheet('sid')).resolves.toMatchObject({
      title: 'Leads 2026',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('401: không tự xin token mới; đánh dấu token hết hạn và báo 30004 chỉ cách chạy batch token', async () => {
    const request = jest.fn().mockReturnValue(fail(401));
    const { client, auth } = setup(request);
    const error = await client.getSpreadsheet('sid').catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'TOKEN_EXPIRED' });
    expect((error as Error).message).toContain('Làm mới token Google');
    expect(auth.markRejected).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('chưa có token trong DB: lỗi của GoogleAuthService đi thẳng ra, không gọi Google', async () => {
    const request = jest.fn();
    const { client, auth } = setup(request);
    auth.getAccessToken.mockRejectedValueOnce(
      new ExternalApiError('google-auth', 'NOT_CONNECTED', 'chưa có token'),
    );
    await expect(client.getSpreadsheet('sid')).rejects.toMatchObject({
      service: 'google-auth',
      kind: 'NOT_CONNECTED',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('403: hướng dẫn share Sheet cho service account; 404: sai Sheet ID', async () => {
    await expect(
      setup(jest.fn().mockReturnValue(fail(403))).client.getSpreadsheet('sid'),
    ).rejects.toThrow(
      'Google từ chối truy cập Sheet. Hãy chia sẻ Sheet cho sa@x.iam.gserviceaccount.com với quyền Người chỉnh sửa',
    );
    await expect(
      setup(jest.fn().mockReturnValue(fail(404))).client.getSpreadsheet('abc'),
    ).rejects.toThrow('Không tìm thấy Google Sheet có ID abc');
  });

  it('toSheetCell: chuẩn hóa ô API', () => {
    expect(
      toSheetCell({
        formattedValue: ' a ',
        effectiveValue: { stringValue: 'a' },
      }),
    ).toEqual({ text: 'a', value: 'a', formatType: undefined });
    expect(toSheetCell({})).toEqual({
      text: '',
      value: undefined,
      formatType: undefined,
    });
  });
});
