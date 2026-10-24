import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { API_KEY_HEADER } from '../common/auth/api-key.guard';
import { API_DOC } from '../common/constants/messages.constant';

/** Tài liệu OpenAPI, dùng chung cho /docs và scripts/swagger-export.ts. */
export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(API_DOC.TITLE)
      .setDescription(API_DOC.DESCRIPTION(API_KEY_HEADER))
      .setVersion('1.0')
      .addApiKey(
        { type: 'apiKey', name: API_KEY_HEADER, in: 'header' },
        'api-key',
      )
      .addSecurityRequirements('api-key')
      .build(),
  );
}

/** Swagger UI tại /docs (JSON tại /docs-json), nút Authorize cho x-api-key. */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildSwaggerDocument(app), {
    swaggerOptions: { persistAuthorization: true },
  });
}
