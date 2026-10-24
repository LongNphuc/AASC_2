import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Khoảng thời gian: date_range=7d|30d|90d, hoặc from/to (ngày theo APP_TIMEZONE). */
export class DateRangeQuery {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d'], default: '30d' })
  @IsOptional()
  @IsIn(['7d', '30d', '90d'])
  date_range?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-21' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

/** Tham số của GET /api/v1/analytics/conversion-rates (readme_design.md mục 9.3). */
export class ConversionRatesQuery extends DateRangeQuery {
  @ApiPropertyOptional({
    enum: ['campaign', 'ad', 'form', 'event_type', 'day'],
    default: 'campaign',
  })
  @IsOptional()
  @IsIn(['campaign', 'ad', 'form', 'event_type', 'day'])
  group_by?: 'campaign' | 'ad' | 'form' | 'event_type' | 'day';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  campaign_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  ad_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  form_id?: string;

  @ApiPropertyOptional({
    enum: ['lead.generate', 'form.complete', 'user.interaction'],
  })
  @IsOptional()
  @IsIn(['lead.generate', 'form.complete', 'user.interaction'])
  event_type?: string;
}

export class CampaignPerformanceQuery extends DateRangeQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  campaign_id?: string;
}
