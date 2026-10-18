import { Module } from '@nestjs/common';
import { BitrixModule } from '../bitrix/bitrix.module';
import { LeadDedupeService } from './services/lead-dedupe.service';
import { LeadWriterService } from './services/lead-writer.service';

/** Tra trùng lead trên Bitrix24 và gửi lệnh tạo/cập nhật theo batch. */
@Module({
  imports: [BitrixModule],
  providers: [LeadDedupeService, LeadWriterService],
  exports: [LeadDedupeService, LeadWriterService],
})
export class LeadsModule {}
