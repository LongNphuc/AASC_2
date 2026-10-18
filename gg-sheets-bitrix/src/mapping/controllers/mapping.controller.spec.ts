import { ExternalApiError } from '../../common/errors/external-api.error';
import { MAPPING } from '../../testing/fixtures';
import type { MappingService } from '../services/mapping.service';
import { MappingController } from './mapping.controller';

describe('MappingController', () => {
  const latest = {
    uuid: 'u',
    version: 3,
    mappingJson: MAPPING,
    createdAt: new Date('2026-10-17T00:00:00Z'),
  };

  it('GET /mapping: phiên bản mới nhất kèm kết quả kiểm tra; chưa có mapping; lỗi khi kiểm tra', async () => {
    const service = {
      latest: jest.fn().mockResolvedValue(latest),
      check: jest.fn().mockResolvedValue({ issues: [] }),
    };
    const ctrl = new MappingController(service as unknown as MappingService);
    expect(await ctrl.current()).toEqual({
      version: 3,
      mappingJson: MAPPING,
      createdAt: latest.createdAt,
      valid: true,
      errors: [],
    });

    service.check.mockRejectedValueOnce(
      new ExternalApiError('google-sheets', 'SHEET_NOT_FOUND', 'không có tab'),
    );
    expect(await ctrl.current()).toMatchObject({
      valid: false,
      errors: [{ errorKbn: 30014, message: 'không có tab' }],
    });

    service.latest.mockResolvedValueOnce(null);
    expect(await ctrl.current()).toMatchObject({ version: null, valid: false });
  });

  it('PUT /mapping, phiên bản, luật', async () => {
    const service = {
      save: jest.fn().mockResolvedValue({ version: 4, createdAt: 'now' }),
      listVersions: jest.fn().mockResolvedValue([{ version: 4 }]),
      findVersion: jest.fn().mockResolvedValue(latest),
    };
    const ctrl = new MappingController(service as unknown as MappingService);
    expect(await ctrl.save({ baseVersion: 3, mappingJson: {} })).toEqual({
      version: 4,
      createdAt: 'now',
    });
    expect(await ctrl.versions()).toEqual([{ version: 4 }]);
    expect(await ctrl.version(3)).toMatchObject({ version: 3 });
    expect(ctrl.rules().map((r) => r.name)).toContain('is_phone_vn');
  });
});
