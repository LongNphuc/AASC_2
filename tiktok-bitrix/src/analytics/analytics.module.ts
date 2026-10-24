import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigurationsModule } from '../configurations/configurations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AlertsModule } from './alerts.module';
import { AlertsController } from './controllers/alerts.controller';
import { AnalyticsController } from './controllers/analytics.controller';
import { ReportsController } from './controllers/reports.controller';
import { Alert } from './entities/alert.entity';
import { CampaignSpend } from './entities/campaign-spend.entity';
import { Report } from './entities/report.entity';
import { MetricsRepository } from './repositories/metrics.repository';
import { AlertCheckService } from './services/alert-check.service';
import { AnalyticsService } from './services/analytics.service';
import { DailyReportService } from './services/daily-report.service';
import { ExportService } from './services/export.service';

/** Module 3: chỉ số, dashboard API, export, báo cáo định kỳ, cảnh báo (readme_design.md mục 9). */
@Module({
  imports: [
    TypeOrmModule.forFeature([CampaignSpend, Report, Alert]),
    AlertsModule,
    NotificationsModule,
    ConfigurationsModule,
  ],
  controllers: [AnalyticsController, ReportsController, AlertsController],
  providers: [
    MetricsRepository,
    AnalyticsService,
    ExportService,
    DailyReportService,
    AlertCheckService,
  ],
  exports: [AnalyticsService, DailyReportService, AlertCheckService],
})
export class AnalyticsModule {}
