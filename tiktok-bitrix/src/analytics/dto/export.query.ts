import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { DateRangeQuery } from './analytics.query';

/** Tham số của GET /api/v1/reports/export (readme_design.md mục 9.6). */
export class ExportQuery extends DateRangeQuery {
  @ApiPropertyOptional({ enum: ['csv', 'json', 'xlsx'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'json', 'xlsx'])
  format?: 'csv' | 'json' | 'xlsx';

  @ApiPropertyOptional({
    enum: ['submissions', 'deals', 'campaigns'],
    default: 'submissions',
  })
  @IsOptional()
  @IsIn(['submissions', 'deals', 'campaigns'])
  type?: 'submissions' | 'deals' | 'campaigns';
}
