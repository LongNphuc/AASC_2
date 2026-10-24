import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Repository } from 'typeorm';
import { API_DOC, ERROR } from '../../common/constants/messages.constant';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { paginate, PaginationQuery } from '../../common/query/pagination.dto';
import { ExportQuery } from '../dto/export.query';
import { Report } from '../entities/report.entity';
import { ExportService } from '../services/export.service';

@ApiTags('Báo cáo')
@Controller('api/v1/reports')
export class ReportsController {
  constructor(
    private readonly exporter: ExportService,
    @InjectRepository(Report) private readonly reports: Repository<Report>,
  ) {}

  /** Ghi luồng ra response; giới hạn 5 lần mỗi phút (nhóm throttler export). */
  @Get('export')
  @ApiOperation(API_DOC.REPORTS.EXPORT)
  @ApiProduces(
    'text/csv',
    'application/json',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  async export(
    @Query() query: ExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    await this.exporter.stream(query, res);
  }

  @Get()
  @ApiOperation(API_DOC.REPORTS.LIST)
  async list(@Query() query: PaginationQuery) {
    const [rows, total] = await this.reports.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        uuid: true,
        type: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
      },
    });
    return paginate(rows, total, query);
  }

  @Get(':uuid')
  @ApiOperation(API_DOC.REPORTS.DETAIL)
  async detail(@Param('uuid', ParseUUIDPipe) uuid: string) {
    const report = await this.reports.findOneBy({ uuid });
    if (!report) {
      throw new KbnHttpException(
        404,
        ErrorKbn.NOT_FOUND,
        ERROR.LABEL.NOT_FOUND,
        ERROR.REPORT.NOT_FOUND(uuid),
      );
    }
    return report;
  }
}
