import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BitrixMetadataService } from '../../bitrix/services/bitrix-metadata.service';
import type { AppConfig } from '../../config/app-config';
import type { SheetsClient } from '../../google/clients/sheets.client';
import { HEADERS, MAPPING, METADATA } from '../../testing/fixtures';
import type { MappingRepository } from '../repositories/mapping.repository';
import { MappingValidatorService } from './mapping-validator.service';
import { MappingService } from './mapping.service';

const dir = mkdtempSync(join(tmpdir(), 'mapping-'));
const goodFile = join(dir, 'mapping.json');
writeFileSync(goodFile, JSON.stringify(MAPPING));
const badFile = join(dir, 'bad.json');
writeFileSync(badFile, '{ "columns": [] ');

function setup(mappingFile = goodFile, latest: unknown = null) {
  const repo = {
    latest: jest.fn().mockResolvedValue(latest),
    insert: jest
      .fn()
      .mockImplementation((version: number, mappingJson: unknown) =>
        Promise.resolve({
          uuid: 'u',
          version,
          mappingJson,
          createdAt: new Date(),
        }),
      ),
    findVersion: jest.fn(),
    findByUuid: jest.fn(),
    list: jest.fn().mockResolvedValue([{ version: 1 }]),
  };
  const sheets = {
    assertTab: jest.fn().mockResolvedValue({}),
    readGrid: jest.fn().mockResolvedValue([HEADERS.map((h) => ({ text: h }))]),
  };
  const metadata = { loadForRun: jest.fn().mockResolvedValue(METADATA) };
  const config = {
    mappingFile,
    google: { spreadsheetId: 'sid', sheetName: 'Leads' },
  } as AppConfig;
  const service = new MappingService(
    repo as unknown as MappingRepository,
    new MappingValidatorService(),
    sheets as unknown as SheetsClient,
    metadata as unknown as BitrixMetadataService,
    config,
  );
  return { repo, sheets, service };
}

describe('MappingService', () => {
  it('khởi động mà bảng trống: nạp mapping.json thành phiên bản 1', async () => {
    const { repo, service } = setup();
    await service.onModuleInit();
    expect(repo.insert).toHaveBeenCalledWith(1, MAPPING);
  });

  it('đã có mapping trong DB thì không nạp lại tệp; tệp hỏng hoặc thiếu thì chỉ cảnh báo', async () => {
    const existing = setup(goodFile, { version: 3 });
    await existing.service.onModuleInit();
    expect(existing.repo.insert).not.toHaveBeenCalled();
    for (const file of [badFile, join(dir, 'missing.json')]) {
      const t = setup(file);
      await t.service.onModuleInit();
      expect(t.repo.insert).not.toHaveBeenCalled();
    }
  });

  it('check: kiểm tra đủ ba tầng với tiêu đề Sheet (dòng 1) và trường Bitrix24', async () => {
    const { sheets, service } = setup();
    expect(await service.check(MAPPING)).toEqual({
      config: MAPPING,
      issues: [],
    });
    expect(sheets.readGrid).toHaveBeenCalledWith('sid', 'Leads', '1:1');
    const broken = await service.check({
      ...MAPPING,
      columns: [{ header: 'Không có', field: 'NAME' }],
    });
    // Thiếu cột trên Sheet; EMAIL, PHONE chưa ánh xạ; lead_title dùng 2 cột không có trong columns.
    expect(broken.issues.map((i) => i.errorKbn)).toEqual([
      20005, 20004, 20004, 20004, 20004,
    ]);
  });

  it('save: lưu thành phiên bản mới; sai thì 400 kèm lỗi; đã có bản mới hơn thì 409', async () => {
    const { repo, service } = setup(goodFile, { version: 3 });
    await expect(service.save(3, MAPPING)).resolves.toMatchObject({
      version: 4,
    });
    await expect(service.save(2, MAPPING)).rejects.toMatchObject({
      errorKbn: 20009,
    });
    await expect(service.save(3, { columns: [] })).rejects.toMatchObject({
      errorKbn: 20004,
    });
    repo.insert.mockRejectedValueOnce({ driverError: { code: '23505' } });
    await expect(service.save(3, MAPPING)).rejects.toMatchObject({
      errorKbn: 20009,
    });
  });

  it('đọc phiên bản: không có thì 404', async () => {
    const { repo, service } = setup();
    repo.findVersion
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ version: 2 });
    await expect(service.findVersion(9)).rejects.toMatchObject({
      errorKbn: 20003,
    });
    await expect(service.findVersion(2)).resolves.toEqual({ version: 2 });
    await expect(service.listVersions()).resolves.toEqual([{ version: 1 }]);
  });
});
