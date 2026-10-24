import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { logFiles } from '../common/logging/log-files';
import { loadEnvFileIfPresent } from '../config/load-env-file';
import { CoreModule } from '../core.module';
import { ImportsModule } from '../imports/imports.module';
import { HistoryImportService } from '../imports/services/history-import.service';

@Module({
  imports: [CoreModule.forRoot({ runMigrations: false }), ImportsModule],
})
class ImportScriptModule {}

/**
 * npm run import:history -- --file samples/history/leads-2025.json
 * (trong Docker: docker compose exec worker node dist/scripts/import-history.js --file …).
 * Chỉ đẩy job; worker xử lý dần, ưu tiên thấp hơn webhook (readme_design.md mục 9.9).
 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { file: { type: 'string' } } });
  if (!values.file) throw new Error('Thiếu --file <tệp JSON>');
  loadEnvFileIfPresent();
  logFiles.configure(process.env.LOG_DIR || 'logs', 'import');
  const app = await NestFactory.createApplicationContext(ImportScriptModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const result = await app.get(HistoryImportService).run(values.file);
    console.log(
      `[import] ${result.fileName}: ${result.total} bản ghi, đẩy ${result.enqueued} job`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('[import]', error instanceof Error ? error.message : error);
  process.exit(1);
});
