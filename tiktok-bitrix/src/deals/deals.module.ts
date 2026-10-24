import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BitrixModule } from '../bitrix/bitrix.module';
import { ConfigurationsModule } from '../configurations/configurations.module';
import { LeadSyncModule } from '../lead-sync/lead-sync.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DealsController } from './controllers/deals.controller';
import { Deal } from './entities/deal.entity';
import { DealQueryRepository } from './repositories/deal-query.repository';
import { AssignmentService } from './services/assignment.service';
import { DealEventsService } from './services/deal-events.service';
import { DealNotifyService } from './services/deal-notify.service';
import { DealPushService } from './services/deal-push.service';
import { DealRulesService } from './services/deal-rules.service';
import { ProbabilityService } from './services/probability.service';

/** Module 2: rule tạo deal, đẩy deal lên Bitrix24, deal đổi stage (readme_design.md mục 6, 7). */
@Module({
  imports: [
    TypeOrmModule.forFeature([Deal]),
    BitrixModule,
    ConfigurationsModule,
    LeadSyncModule,
    NotificationsModule,
  ],
  controllers: [DealsController],
  providers: [
    DealQueryRepository,
    DealRulesService,
    DealPushService,
    DealEventsService,
    DealNotifyService,
    ProbabilityService,
    AssignmentService,
  ],
  exports: [
    TypeOrmModule,
    DealQueryRepository,
    DealRulesService,
    DealPushService,
    DealEventsService,
    DealNotifyService,
  ],
})
export class DealsModule {}
