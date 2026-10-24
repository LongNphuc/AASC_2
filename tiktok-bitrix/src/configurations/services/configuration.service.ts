import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Repository } from 'typeorm';
import { ERROR, LOG } from '../../common/constants/messages.constant';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { REDIS } from '../../common/redis/redis.module';
import { appConfig, type AppConfig } from '../../config/app-config';
import { returningRows } from '../../database/query-result';
import { Configuration } from '../entities/configuration.entity';
import {
  CONFIG_KEY,
  type ConfigKey,
  type StoredConfig,
} from '../types/configuration.types';

/** Thư mục cấu hình mặc định, nạp khi bảng configurations trống. */
export const SEED_DIR = join(process.cwd(), 'seeds', 'configurations');

/**
 * Cấu hình trong DB: mapping, rule, ngưỡng cảnh báo (readme_design.md mục 13).
 * Đọc qua cache Redis `config:{key}`, xóa cache ngay khi lưu; lưu kèm
 * `version` để hai người sửa cùng lúc không đè nhau (409, 20009).
 */
@Injectable()
export class ConfigurationService {
  private readonly logger = new Logger(ConfigurationService.name);

  constructor(
    @InjectRepository(Configuration)
    private readonly configurations: Repository<Configuration>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async get<T>(key: ConfigKey): Promise<StoredConfig<T>> {
    const cached = await this.redis.get(cacheKey(key));
    if (cached) {
      const parsed = JSON.parse(cached) as StoredConfig<T> & {
        updatedAt: string;
      };
      return { ...parsed, updatedAt: new Date(parsed.updatedAt) };
    }
    const row = await this.configurations.findOneBy({ key });
    if (!row) {
      throw new KbnHttpException(
        404,
        ErrorKbn.NOT_FOUND,
        ERROR.LABEL.NOT_FOUND,
        ERROR.CONFIG.MISSING(key),
      );
    }
    const stored: StoredConfig<T> = {
      value: row.value as T,
      version: row.version,
      updatedAt: row.updatedAt,
    };
    await this.redis.set(
      cacheKey(key),
      JSON.stringify(stored),
      'EX',
      this.config.cache.configSeconds,
    );
    return stored;
  }

  /** Lưu nếu `version` gửi lên khớp bản đang lưu; lệch thì 409 (20009). */
  async save<T>(
    key: ConfigKey,
    value: T,
    version: number,
  ): Promise<StoredConfig<T>> {
    const result: unknown = await this.configurations.query(
      `UPDATE configurations
          SET value = $1, version = version + 1, updated_at = now()
        WHERE key = $2 AND version = $3
        RETURNING version, updated_at`,
      [JSON.stringify(value), key, version],
    );
    const updated = returningRows<{ version: number; updated_at: Date }>(
      result,
    );
    if (updated.length === 0) {
      const current = await this.configurations.findOneBy({ key });
      throw new KbnHttpException(
        409,
        ErrorKbn.CONFIG_CONFLICT,
        ERROR.LABEL.CONFIG_CONFLICT,
        ERROR.CONFIG.CONFLICT(version, current?.version ?? 0),
        { currentVersion: current?.version },
      );
    }
    await this.redis.del(cacheKey(key));
    this.logger.log(LOG.CONFIG.SAVED(key, updated[0].version));
    return {
      value,
      version: updated[0].version,
      updatedAt: updated[0].updated_at,
    };
  }

  /** Lần khởi động đầu: bảng trống thì nạp seeds/configurations/*.json (phiên bản 1). */
  async loadDefaultsIfEmpty(seedDir = SEED_DIR): Promise<void> {
    if ((await this.configurations.count()) > 0) return;
    const keys = Object.values(CONFIG_KEY);
    for (const key of keys) {
      const value = JSON.parse(
        await readFile(join(seedDir, `${key}.json`), 'utf8'),
      ) as Record<string, unknown>;
      await this.configurations.query(
        `INSERT INTO configurations (key, value, version) VALUES ($1, $2, 1) ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(value)],
      );
      await this.redis.del(cacheKey(key));
    }
    this.logger.log(LOG.CONFIG.SEEDED(keys.join(', ')));
  }
}

function cacheKey(key: string): string {
  return `config:${key}`;
}
