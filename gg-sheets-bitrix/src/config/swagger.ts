import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_KEY_HEADER } from '../common/auth/api-key.guard';
import { API_DOC } from '../common/constants/messages.constant';

/** Tài liệu API tự động tại /docs (JSON tại /docs-json). */
export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(API_DOC.TITLE)
      .setDescription(API_DOC.DESCRIPTION(API_KEY_HEADER))
      .setVersion('1.0')
      .addApiKey(
        { type: 'apiKey', name: API_KEY_HEADER, in: 'header' },
        'api-key',
      )
      .build(),
  );
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
