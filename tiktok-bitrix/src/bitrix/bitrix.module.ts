import { Module } from '@nestjs/common';
import { Bitrix24Client } from './clients/bitrix24.client';
import { BitrixController } from './controllers/bitrix.controller';
import { BitrixMetadataService } from './services/bitrix-metadata.service';

@Module({
  controllers: [BitrixController],
  providers: [Bitrix24Client, BitrixMetadataService],
  exports: [Bitrix24Client, BitrixMetadataService],
})
export class BitrixModule {}
