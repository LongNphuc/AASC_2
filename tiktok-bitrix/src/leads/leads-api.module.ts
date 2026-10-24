import { Module } from '@nestjs/common';
import { DealsModule } from '../deals/deals.module';
import { QueuesModule } from '../queues/queues.module';
import { LeadsController } from './controllers/leads.controller';
import { LeadsModule } from './leads.module';
import { LeadQueryRepository } from './repositories/lead-query.repository';
import { LeadConversionService } from './services/lead-conversion.service';

/**
 * API lead: danh sách, chi tiết, chuyển tay thành deal. Tách khỏi LeadsModule
 * vì cần DealsModule, mà DealsModule (qua LeadSyncModule) đã dùng LeadsModule.
 */
@Module({
  imports: [LeadsModule, DealsModule, QueuesModule],
  controllers: [LeadsController],
  providers: [LeadQueryRepository, LeadConversionService],
})
export class LeadsApiModule {}
