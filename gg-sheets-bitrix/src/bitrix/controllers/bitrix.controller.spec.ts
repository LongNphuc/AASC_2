import type { AppConfig } from '../../config/app-config';
import { ExternalApiError } from '../../common/errors/external-api.error';
import type { BitrixWebhookClient } from '../clients/bitrix-webhook.client';
import type { BitrixMetadataService } from '../services/bitrix-metadata.service';
import { BitrixController } from './bitrix.controller';

const config = {
  bitrix: { webhookUrl: 'https://p.bitrix24.vn/rest/1/secret' },
} as AppConfig;

describe('BitrixController', () => {
  it('status: che mã webhook, báo quyền còn thiếu', async () => {
    const bitrix = { call: jest.fn().mockResolvedValue(['crm']) };
    const ctrl = new BitrixController(
      bitrix as unknown as BitrixWebhookClient,
      {} as BitrixMetadataService,
      config,
    );
    expect(await ctrl.status()).toEqual({
      ok: false,
      webhook: 'https://p.bitrix24.vn/rest/1/***',
      scopes: ['crm'],
      missingScopes: ['user'],
    });
  });

  it('status: lỗi gọi Bitrix24 thì trả lý do và mã lỗi', async () => {
    const bitrix = {
      call: jest
        .fn()
        .mockRejectedValue(
          new ExternalApiError('bitrix24', 'AUTH', 'sai webhook'),
        ),
    };
    const ctrl = new BitrixController(
      bitrix as unknown as BitrixWebhookClient,
      {} as BitrixMetadataService,
      { bitrix: {} } as AppConfig,
    );
    expect(await ctrl.status()).toEqual({
      ok: false,
      webhook: null,
      errorKbn: 40003,
      error: 'sai webhook',
    });
  });

  it('lead-fields: mã, tên hiển thị, kiểu, lựa chọn', async () => {
    const metadata = {
      leadFields: jest.fn().mockResolvedValue({
        STATUS_ID: {
          type: 'crm_status',
          statusType: 'STATUS',
          title: 'Giai đoạn',
        },
        UF_CRM_1: {
          type: 'enumeration',
          listLabel: 'Lĩnh vực',
          isMultiple: false,
          items: [{ ID: '45', VALUE: 'BĐS' }],
        },
      }),
    };
    const ctrl = new BitrixController(
      {} as BitrixWebhookClient,
      metadata as unknown as BitrixMetadataService,
      config,
    );
    expect(await ctrl.leadFields()).toEqual([
      {
        code: 'STATUS_ID',
        title: 'Giai đoạn',
        type: 'crm_status',
        isMultiple: false,
        isReadOnly: false,
        statusType: 'STATUS',
      },
      {
        code: 'UF_CRM_1',
        title: 'Lĩnh vực',
        type: 'enumeration',
        isMultiple: false,
        isReadOnly: false,
        items: ['BĐS'],
      },
    ]);
  });
});
