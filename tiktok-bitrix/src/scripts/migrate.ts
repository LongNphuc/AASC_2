import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadEnvFileIfPresent } from '../config/load-env-file';
import { dataSourceOptions } from '../database/data-source';

/**
 * Chạy migration riêng, khi triển khai nhiều instance api và đặt
 * DB_MIGRATIONS_RUN=false (readme_run.md bước 8):
 *   node dist/scripts/migrate.js            chạy các migration chưa chạy
 *   node dist/scripts/migrate.js --revert   lùi migration gần nhất
 */
async function main(): Promise<void> {
  loadEnvFileIfPresent();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Thiếu DATABASE_URL');
  const dataSource = await new DataSource(dataSourceOptions(url)).initialize();
  try {
    if (process.argv.includes('--revert')) {
      await dataSource.undoLastMigration({ transaction: 'each' });
      console.log('[migrate] Đã lùi migration gần nhất');
    } else {
      const done = await dataSource.runMigrations({ transaction: 'each' });
      console.log(
        `[migrate] ${done.length ? done.map((m) => m.name).join(', ') : 'Không có migration mới'}`,
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error('[migrate]', error instanceof Error ? error.message : error);
  process.exit(1);
});
