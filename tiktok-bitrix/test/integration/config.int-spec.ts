import { ErrorKbn } from '../../src/common/kbn/error.kbn';
import { seedConfig } from '../../src/testing/fixtures';
import {
  resetState,
  startApi,
  startMock,
  stopAll,
  type ApiHandle,
  type MockHandle,
} from '../helpers/harness';

describe('Cấu hình (integration)', () => {
  let mock: MockHandle;
  let api: ApiHandle;

  beforeAll(async () => {
    mock = await startMock();
    api = await startApi();
  });
  beforeEach(() => resetState(api, mock));
  afterAll(() => stopAll(api, mock));

  describe('/api/v1/config/mappings', () => {
    it('GET trả đúng dạng PUT nhận, kèm khóa chỉ đọc', async () => {
      const res = await api.http().get('/api/v1/config/mappings').expect(200);
      expect(res.body).toMatchObject({
        field_mapping: seedConfig('field_mapping'),
        version: 1,
        supported_paths: expect.arrayContaining([
          'lead_data.email',
          'answers.<slug>',
        ]) as string[],
        reserved_fields: expect.arrayContaining([
          'TITLE',
          'UF_CRM_SOURCES',
        ]) as string[],
      });
      expect(res.body.updated_at).toBeDefined();
    });

    it('PUT hợp lệ: lưu phiên bản 2, GET thấy ngay', async () => {
      const field_mapping = {
        'lead_data.full_name': 'NAME',
        'lead_data.email': 'EMAIL[0][VALUE]',
        'lead_data.city': 'ADDRESS_CITY',
      };
      const res = await api
        .http()
        .put('/api/v1/config/mappings')
        .send({ field_mapping, version: 1 })
        .expect(200);
      expect(res.body).toMatchObject({ field_mapping, version: 2 });
      expect(
        (await api.http().get('/api/v1/config/mappings')).body.field_mapping,
      ).toEqual(field_mapping);
    });

    it('field không có trên portal (E12): 400 kèm lỗi từng chỗ, không lưu', async () => {
      const field_mapping = {
        ...seedConfig<Record<string, string>>('field_mapping'),
        'lead_data.city': 'UF_CRM_CTY',
        'lead_data.fullname': 'NAME',
      };
      const res = await api
        .http()
        .put('/api/v1/config/mappings')
        .send({ field_mapping, version: 1 })
        .expect(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        details: {
          errors: expect.arrayContaining([
            expect.objectContaining({
              path: 'lead_data.fullname',
              errorKbn: ErrorKbn.CONFIG_INVALID,
            }),
            expect.objectContaining({
              path: 'lead_data.city',
              field: 'UF_CRM_CTY',
              errorKbn: ErrorKbn.FIELD_INVALID,
            }),
          ]) as object[],
        },
      });
      expect(
        (await api.http().get('/api/v1/config/mappings')).body.version,
      ).toBe(1);

      // Chỉ lỗi field trên portal: mã chung là 20006.
      const onlyField = {
        ...seedConfig<Record<string, string>>('field_mapping'),
        'lead_data.city': 'UF_CRM_CTY',
      };
      const res2 = await api
        .http()
        .put('/api/v1/config/mappings')
        .send({ field_mapping: onlyField, version: 1 })
        .expect(400);
      expect(res2.body.errorKbn).toBe(ErrorKbn.FIELD_INVALID);
    });

    it('thiếu version, khóa lạ: 400 20001', async () => {
      const res = await api
        .http()
        .put('/api/v1/config/mappings')
        .send({ field_mapping: {}, extra: 1 })
        .expect(400);
      expect(res.body.errorKbn).toBe(ErrorKbn.VALIDATION);
    });
  });

  describe('/api/v1/config/rules', () => {
    const rules = seedConfig<Record<string, unknown>>('deal_rules');

    it('GET, PUT; hai người cùng sửa (E14): người lưu sau 409 20009', async () => {
      expect(
        (await api.http().get('/api/v1/config/rules').expect(200)).body,
      ).toMatchObject({ ...rules, version: 1 });
      await api
        .http()
        .put('/api/v1/config/rules')
        .send({ ...rules, version: 1 })
        .expect(200);
      const conflict = await api
        .http()
        .put('/api/v1/config/rules')
        .send({ ...rules, version: 1 })
        .expect(409);
      expect(conflict.body).toMatchObject({
        errorKbn: ErrorKbn.CONFIG_CONFLICT,
      });
    });

    it('rule sai cú pháp (E13): 400 20004 kèm vị trí', async () => {
      const deal_rules = [
        {
          ...(rules.deal_rules as object[])[0],
          condition: "campaign.campaign_name CONTAIN 'sale'",
        },
      ];
      const res = await api
        .http()
        .put('/api/v1/config/rules')
        .send({ ...rules, deal_rules, version: 1 })
        .expect(400);
      expect(res.body).toMatchObject({
        errorKbn: ErrorKbn.CONFIG_INVALID,
        details: {
          errors: [{ path: 'deal_rules[0].condition', position: 23 }],
        },
      });
    });
  });

  describe('/api/v1/config/alerts, /api/v1/bitrix/lead-fields', () => {
    it('GET, PUT ngưỡng cảnh báo; sai thì 400', async () => {
      const alert_rules = {
        cpl_max: 50000,
        conversion_drop_percent: 20,
        min_leads: 10,
      };
      expect(
        (await api.http().get('/api/v1/config/alerts').expect(200)).body,
      ).toMatchObject({ alert_rules: seedConfig('alert_rules'), version: 1 });
      expect(
        (
          await api
            .http()
            .put('/api/v1/config/alerts')
            .send({ alert_rules, version: 1 })
            .expect(200)
        ).body,
      ).toMatchObject({ alert_rules, version: 2 });
      await api
        .http()
        .put('/api/v1/config/alerts')
        .send({ alert_rules: { ...alert_rules, min_leads: -1 }, version: 2 })
        .expect(400);
    });

    it('lead-fields đọc từ portal, có custom field, qua cache', async () => {
      const res = await api
        .http()
        .get('/api/v1/bitrix/lead-fields')
        .expect(200);
      expect(res.body).toContainEqual({
        code: 'UF_CRM_CITY',
        title: 'Thành phố (TikTok)',
        type: 'string',
        isRequired: false,
        isReadOnly: false,
        isMultiple: false,
      });
      await api.http().get('/api/v1/bitrix/lead-fields').expect(200);
      expect(mock.calls.list('bitrix24', 'crm.lead.fields')).toHaveLength(1);
    });
  });
});
