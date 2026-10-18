import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { appConfig, type AppConfig } from '../config/app-config';
import { BitrixHttpClient } from './clients/bitrix-http.client';
import { BitrixWebhookClient } from './clients/bitrix-webhook.client';
import { BitrixController } from './controllers/bitrix.controller';
import { BitrixMetadataService } from './services/bitrix-metadata.service';

/** Bitrix24 REST qua webhook vào: gọi đơn, batch 50 lệnh, metadata của lead. */
@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [appConfig.KEY],
      useFactory: (config: AppConfig) => ({ timeout: config.httpTimeoutMs }),
    }),
  ],
  controllers: [BitrixController],
  providers: [BitrixHttpClient, BitrixWebhookClient, BitrixMetadataService],
  exports: [BitrixWebhookClient, BitrixMetadataService],
})
export class BitrixModule {}
