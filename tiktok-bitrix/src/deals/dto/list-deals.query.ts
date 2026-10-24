import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQuery } from '../../common/query/pagination.dto';

/** Tham số của GET /api/v1/deals (readme_api.md mục 5). */
export class ListDealsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['open', 'won', 'lost', 'deleted'] })
  @IsOptional()
  @IsIn(['open', 'won', 'lost', 'deleted'])
  status?: string;

  @ApiPropertyOptional({ description: 'ID người dùng Bitrix24', example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assigned_to?: number;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  pipeline_id?: string;

  @ApiPropertyOptional({
    description: 'campaign_id của lượt gửi đã tạo ra deal',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  campaign_id?: string;

  @ApiPropertyOptional({ enum: ['rule', 'manual'] })
  @IsOptional()
  @IsIn(['rule', 'manual'])
  origin?: string;

  @ApiPropertyOptional({
    enum: ['7d', '30d', '90d'],
    description: 'Theo ngày tạo deal',
  })
  @IsOptional()
  @IsIn(['7d', '30d', '90d'])
  date_range?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
