import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { REPORT } from '../../common/constants/messages.constant';
import { NotificationTypeKbn } from '../../common/kbn/type.kbn';
import {
  addDays,
  localDate,
  parseDateRange,
} from '../../common/query/date-range';
import { appConfig, type AppConfig } from '../../config/app-config';
import { jsonValue } from '../../database/json';
import { NotificationService } from '../../notifications/services/notification.service';
import { Report } from '../entities/report.entity';
import { MetricsRepository } from '../repositories/metrics.repository';
import { AnalyticsService } from './analytics.service';
import { deriveMetrics } from './metrics.calculator';

/**
 * Job daily-report lúc REPORT_DAILY_CRON (readme_design.md mục 9.7): chỉ số
 * theo campaign của hôm qua và 7 ngày gần nhất, lưu một dòng reports, gửi tóm
 * tắt cho NOTIFY_ADMIN_USER_IDS.
 */
@Injectable()
export class DailyReportService {
  constructor(
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    private readonly analytics: AnalyticsService,
    private readonly metrics: MetricsRepository,
    private readonly notifications: NotificationService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async run(now = new Date()): Promise<Report> {
    const tz = this.config.timezone;
    const yesterday = addDays(localDate(now, tz), -1);
    const dayRange = parseDateRange({ from: yesterday, to: yesterday }, tz);
    const weekRange = parseDateRange(
      { from: addDays(yesterday, -6), to: yesterday },
      tz,
    );
    const dayTotals = deriveMetrics(await this.metrics.totals(dayRange, {}));
    const weekTotals = deriveMetrics(await this.metrics.totals(weekRange, {}));
    const payload = {
      yesterday: {
        date: yesterday,
        totals: dayTotals,
        campaigns: await this.analytics.campaignItems(dayRange),
      },
      last7Days: {
        from: weekRange.fromDate,
        to: weekRange.toDate,
        totals: weekTotals,
        campaigns: await this.analytics.campaignItems(weekRange),
      },
    };
    const report = await this.reports.save(
      this.reports.create({
        type: 'daily',
        periodStart: yesterday,
        periodEnd: yesterday,
        payload: jsonValue(payload),
      }),
    );
    await this.notifications.notify(
      NotificationTypeKbn.DAILY_REPORT,
      this.config.notify.adminUserIds,
      REPORT.DAILY_SUMMARY(yesterday, dayTotals),
      { type: 'report', uuid: report.uuid },
    );
    return report;
  }
}
