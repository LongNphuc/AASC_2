import type { BitrixWebhookClient } from '../clients/bitrix-webhook.client';
import { ExternalApiError } from '../../common/errors/external-api.error';
import { BitrixMetadataService } from './bitrix-metadata.service';

const fields = {
  NAME: { type: 'string' },
  STATUS_ID: { type: 'crm_status', statusType: 'STATUS' },
  SOURCE_ID: { type: 'crm_status', statusType: 'SOURCE' },
  ASSIGNED_BY_ID: { type: 'user' },
};

describe('BitrixMetadataService', () => {
  it('đọc trường, danh sách trạng thái của trường mapping dùng (một batch), người dùng (phân trang)', async () => {
    const bitrix = {
      call: jest.fn().mockResolvedValue(fields),
      callBatch: jest.fn().mockResolvedValue({
        status_STATUS: {
          ok: true,
          result: [{ STATUS_ID: 'NEW', NAME: 'Mới' }],
        },
      }),
      callPage: jest
        .fn()
        .mockResolvedValueOnce({ result: [{ ID: '1' }], next: 50 })
        .mockResolvedValueOnce({ result: [{ ID: '2' }] }),
    };
    const metadata = await new BitrixMetadataService(
      bitrix as unknown as BitrixWebhookClient,
    ).loadForRun(['NAME', 'STATUS_ID', 'ASSIGNED_BY_ID']);

    expect(Object.keys(bitrix.callBatch.mock.calls[0][0])).toEqual([
      'status_STATUS',
    ]);
    expect(metadata.statuses).toEqual({
      STATUS: [{ STATUS_ID: 'NEW', NAME: 'Mới' }],
    });
    expect(metadata.users.map((u) => u.ID)).toEqual(['1', '2']);
    expect(bitrix.callPage.mock.calls[1][1]).toEqual({
      FILTER: { ACTIVE: true },
      start: 50,
    });
  });

  it('không có trường kiểu user thì không đọc người dùng; lỗi của một danh sách thì ném lỗi', async () => {
    const bitrix = {
      call: jest.fn().mockResolvedValue(fields),
      callBatch: jest.fn().mockResolvedValue({
        status_SOURCE: {
          ok: false,
          error: new ExternalApiError('bitrix24', 'BAD_REQUEST', 'sai'),
        },
      }),
      callPage: jest.fn(),
    };
    const service = new BitrixMetadataService(
      bitrix as unknown as BitrixWebhookClient,
    );
    await expect(service.loadForRun(['SOURCE_ID'])).rejects.toThrow('sai');
    bitrix.callBatch.mockResolvedValue({});
    await expect(service.loadForRun(['NAME'])).resolves.toMatchObject({
      users: [],
    });
    expect(bitrix.callPage).not.toHaveBeenCalled();
  });
});
