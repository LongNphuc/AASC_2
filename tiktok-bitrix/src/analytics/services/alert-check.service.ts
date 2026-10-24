import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ALERT } from '../../common/constants/messages.constant';
import { WebhookStatusKbn } from '../../common/kbn/status.kbn';
import { AlertTypeKbn } from '../../common/kbn/type.kbn';
import {
  addDays,
  localDate,
  parseDateRange,
} from '../../common/query/date-range';
import { appConfig, type AppConfig } from '../../config/app-config';
import { ConfigurationService } from '../../configurations/services/configuration.service';
import {
  CONFIG_KEY,
  type AlertRulesConfig,
} from '../../configurations/types/configuration.types';
import { MetricsRepository } from '../repositories/metrics.repository';
import { AlertService } from './alert.service';
import { AnalyticsService } from './analytics.service';
import { ratio } from './metrics.calculator';

/**
 * Job alert-check mỗi 15 phút (readme_design.md mục 9.8): CPL_HIGH,
 * CONVERSION_DROP, DLQ_NOT_EMPTY theo ngưỡng trong configurations.alert_rules.
 * SYNC_FAILED tạo ngay khi xảy ra (processor); WORKER_DOWN do api kiểm.
 */
@Injectable()
export class AlertCheckService {
  constructor(
    private readonly alerts: AlertService,
    private readonly analytics: AnalyticsService,
    private readonly metrics: MetricsRepository,
    private readonly configs: ConfigurationService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  async check(now = new Date()): Promise<number> {
    const rules = (
      await this.configs.get<AlertRulesConfig>(CONFIG_KEY.ALERT_RULES)
    ).value;
    const tz = this.config.timezone;
    const today = localDate(now, tz);
    let raised = 0;
    const raise = async (...args: Parameters<AlertService['raise']>) => {
      if (await this.alerts.raise(...args)) raised++;
    };

    for (const item of await this.analytics.campaignItems(
      parseDateRange({ from: today, to: today }, tz),
    )) {
      if (item.cpl !== null && item.cpl > rules.cpl_max) {
        await raise(
          AlertTypeKbn.CPL_HIGH,
          `campaign:${item.campaignId}`,
          ALERT.CPL_HIGH(
            item.campaignName ?? item.campaignId ?? '-',
            item.cpl,
            rules.cpl_max,
          ),
          { ...item },
        );
      }
    }

    const current = await this.metrics.grouped(
      'campaign',
      parseDateRange({ from: addDays(today, -6), to: today }, tz),
      {},
    );
    const previous = await this.metrics.grouped(
      'campaign',
      parseDateRange({ from: addDays(today, -13), to: addDays(today, -7) }, tz),
      {},
    );
    for (const row of current) {
      if (row.counts.leads < rules.min_leads) continue;
      const before = previous.find((p) => p.key === row.key);
      const now7 = ratio(row.counts.deals, row.counts.leads);
      const prev7 = before
        ? ratio(before.counts.deals, before.counts.leads)
        : null;
      if (now7 === null || !prev7) continue;
      const drop = ((prev7 - now7) / prev7) * 100;
      if (drop > rules.conversion_drop_percent) {
        await raise(
          AlertTypeKbn.CONVERSION_DROP,
          `campaign:${row.key}`,
          ALERT.CONVERSION_DROP(row.name ?? row.key, now7, prev7, drop),
          { current: now7, previous: prev7 },
        );
      }
    }

    const [{ count }] = await this.dataSource.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM webhook_events
        WHERE status_kbn IN ($1, $2) AND retry_count >= $3
          AND (status_kbn = $1 OR updated_at < now() - interval '30 minutes')`,
      [
        WebhookStatusKbn.FAILED,
        WebhookStatusKbn.RECEIVED,
        this.config.queue.recoveryMaxRounds,
      ],
    );
    if (count > 0) {
      await raise(
        AlertTypeKbn.DLQ_NOT_EMPTY,
        'crm-pipeline',
        ALERT.DLQ_NOT_EMPTY(count),
        { count },
      );
    }
    return raised;
  }
}
