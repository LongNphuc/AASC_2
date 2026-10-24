import { Controller, Get, Inject, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { Repository } from 'typeorm';
import { API_DOC } from '../../common/constants/messages.constant';
import { AlertTypeKbn, kbnFromName, kbnName } from '../../common/kbn/type.kbn';
import { parseDateRange } from '../../common/query/date-range';
import { paginate } from '../../common/query/pagination.dto';
import { appConfig, type AppConfig } from '../../config/app-config';
import { DateRangeQuery } from '../dto/analytics.query';
import { Alert } from '../entities/alert.entity';

const ALERT_TYPES = [
  'cpl_high',
  'conversion_drop',
  'dlq_not_empty',
  'sync_failed',
  'worker_down',
];

class ListAlertsQuery extends DateRangeQuery {
  @ApiPropertyOptional({ enum: ALERT_TYPES })
  @IsOptional()
  @IsIn(ALERT_TYPES)
  type?: string;
}

@ApiTags('Thống kê')
@Controller('api/v1/alerts')
export class AlertsController {
  constructor(
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  @Get()
  @ApiOperation(API_DOC.ALERTS.LIST)
  async list(@Query() query: ListAlertsQuery) {
    const range = parseDateRange(query, this.config.timezone);
    const qb = this.alerts
      .createQueryBuilder('a')
      .where('a.created_at >= :from AND a.created_at < :to', range)
      .orderBy('a.created_at', 'DESC')
      .take(200);
    if (query.type)
      qb.andWhere('a.type_kbn = :type', {
        type: kbnFromName(AlertTypeKbn, query.type),
      });
    const [rows, total] = await qb.getManyAndCount();
    return paginate(
      rows.map((a) => ({
        uuid: a.uuid,
        type: kbnName(AlertTypeKbn, a.typeKbn),
        typeKbn: a.typeKbn,
        subject: a.fingerprint.split(':').slice(1).join(':'),
        message: a.message,
        details: a.details,
        createdAt: a.createdAt,
      })),
      total,
      { page: 1, limit: 200 },
    );
  }
}
