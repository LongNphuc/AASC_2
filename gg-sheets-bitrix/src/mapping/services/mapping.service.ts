import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { BitrixMetadataService } from '../../bitrix/services/bitrix-metadata.service';
import { ERROR, LOG, WARN } from '../../common/constants/messages.constant';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { appConfig, type AppConfig } from '../../config/app-config';
import { SheetsClient } from '../../google/clients/sheets.client';
import { requireSheetConfig } from '../../google/helpers/sheet-config';
import { Mapping } from '../entities/mapping.entity';
import { MappingRepository } from '../repositories/mapping.repository';
import type { MappingConfig, MappingIssue } from '../types/mapping.types';
import { MappingValidatorService } from './mapping-validator.service';

/**
 * Mapping lưu trong bảng mappings theo phiên bản:
 * - khởi động mà bảng trống thì nạp MAPPING_FILE (mapping.json) thành phiên bản 1;
 * - lưu trên admin panel tạo phiên bản mới, không sửa phiên bản cũ;
 * - lần chạy dùng phiên bản mới nhất.
 */
@Injectable()
export class MappingService implements OnModuleInit {
  private readonly logger = new Logger(MappingService.name);

  constructor(
    private readonly repo: MappingRepository,
    private readonly validator: MappingValidatorService,
    private readonly sheets: SheetsClient,
    private readonly metadata: BitrixMetadataService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const latest = await this.repo.latest();
    if (latest) {
      this.logger.log(LOG.MAPPING.IN_USE(latest.version));
      return;
    }
    await this.seedFromFile();
  }

  latest(): Promise<Mapping | null> {
    return this.repo.latest();
  }

  findByUuid(uuid: string): Promise<Mapping | null> {
    return this.repo.findByUuid(uuid);
  }

  async findVersion(version: number): Promise<Mapping> {
    const mapping = await this.repo.findVersion(version);
    if (!mapping) {
      throw new KbnHttpException(
        HttpStatus.NOT_FOUND,
        ErrorKbn.NOT_FOUND,
        'NOT_FOUND',
        ERROR.MAPPING.NOT_FOUND(version),
      );
    }
    return mapping;
  }

  listVersions() {
    return this.repo.list();
  }

  /** Kiểm tra đủ ba tầng: cấu trúc, dòng tiêu đề của Sheet, trường trên Bitrix24. */
  async check(
    json: unknown,
  ): Promise<{ config?: MappingConfig; issues: MappingIssue[] }> {
    const structure = this.validator.validateStructure(json);
    if (!structure.config) return structure;
    const { spreadsheetId, sheetName } = requireSheetConfig(this.config);
    await this.sheets.assertTab(spreadsheetId, sheetName);
    const [headerRow = []] = await this.sheets.readGrid(
      spreadsheetId,
      sheetName,
      '1:1',
    );
    const metadata = await this.metadata.loadForRun(
      structure.config.columns.map((c) => c.field),
    );
    const issues = this.validator.validateAgainst(
      structure.config,
      headerRow.map((c) => c.text),
      metadata,
    );
    return issues.length ? { issues } : { config: structure.config, issues };
  }

  /** Lưu thành phiên bản mới; `baseVersion` là phiên bản người sửa đang xem. */
  async save(baseVersion: number, json: unknown): Promise<Mapping> {
    const { config, issues } = await this.check(json);
    if (!config) {
      throw new KbnHttpException(
        HttpStatus.BAD_REQUEST,
        issues[0].errorKbn,
        ERROR.LABEL.MAPPING_INVALID,
        ERROR.SYNC.MAPPING_INVALID(issues.length, issues[0].message),
        { errors: issues },
      );
    }
    const latestVersion = (await this.repo.latest())?.version ?? 0;
    if (latestVersion !== baseVersion) {
      throw conflict(latestVersion);
    }
    try {
      const saved = await this.repo.insert(latestVersion + 1, config);
      this.logger.log(LOG.MAPPING.SAVED(saved.version));
      return saved;
    } catch (error) {
      // Hai người lưu cùng lúc: version là unique nên lần lưu sau bị từ chối.
      if (isUniqueViolation(error)) throw conflict(latestVersion + 1);
      throw error;
    }
  }

  private async seedFromFile(): Promise<void> {
    const file = this.config.mappingFile;
    if (!existsSync(file)) {
      this.logger.warn(WARN.MAPPING.SEED_FILE_MISSING(file));
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      this.logger.warn(
        WARN.MAPPING.SEED_INVALID(
          file,
          error instanceof Error ? error.message : String(error),
        ),
      );
      return;
    }
    const { config, issues } = this.validator.validateStructure(json);
    if (!config) {
      this.logger.warn(WARN.MAPPING.SEED_INVALID(file, issues[0].message));
      return;
    }
    try {
      await this.repo.insert(1, config);
      this.logger.log(LOG.MAPPING.SEEDED(file));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
}

function conflict(latest: number): KbnHttpException {
  return new KbnHttpException(
    HttpStatus.CONFLICT,
    ErrorKbn.MAPPING_CONFLICT,
    ERROR.LABEL.MAPPING_CONFLICT,
    ERROR.MAPPING.CONFLICT(latest),
    { latestVersion: latest },
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    (error as { code?: string; driverError?: { code?: string } })?.driverError
      ?.code === '23505' || (error as { code?: string })?.code === '23505'
  );
}
