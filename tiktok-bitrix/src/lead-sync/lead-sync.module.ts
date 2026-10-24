import { Module } from '@nestjs/common';
import { BitrixModule } from '../bitrix/bitrix.module';
import { ConfigurationsModule } from '../configurations/configurations.module';
import { LeadsModule } from '../leads/leads.module';
import { FieldMapperService } from './services/field-mapper.service';
import { LeadSyncService } from './services/lead-sync.service';
import { TimelineService } from './services/timeline.service';

@Module({
  imports: [BitrixModule, ConfigurationsModule, LeadsModule],
  providers: [LeadSyncService, TimelineService, FieldMapperService],
  exports: [LeadSyncService, TimelineService, FieldMapperService],
})
export class LeadSyncModule {}
