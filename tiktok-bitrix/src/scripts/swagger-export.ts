import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ApiModule } from '../api.module';
import { buildSwaggerDocument } from '../config/swagger';

/**
 * npm run swagger:export → docs/swagger.json (đề: "Swagger JSON export").
 * Chạy Nest ở chế độ preview: đọc metadata của controller mà không khởi tạo
 * provider, nên không cần DB, Redis hay .env.
 */
async function main(): Promise<void> {
  const app = await NestFactory.create(ApiModule, {
    preview: true,
    logger: false,
    abortOnError: false,
  });
  const document = buildSwaggerDocument(app);
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/swagger.json', `${JSON.stringify(document, null, 2)}\n`);
  console.log(
    `[swagger] docs/swagger.json: ${Object.keys(document.paths).length} đường dẫn`,
  );
  await app.close();
}

main().catch((error: unknown) => {
  console.error('[swagger]', error instanceof Error ? error.message : error);
  process.exit(1);
});
