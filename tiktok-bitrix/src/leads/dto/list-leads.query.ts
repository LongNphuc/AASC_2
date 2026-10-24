import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQuery } from '../../common/query/pagination.dto';

/** Tham số của GET /api/v1/leads (readme_api.md mục 4). */
export class ListLeadsQuery extends PaginationQuery {
  @ApiPropertyOptional({
    enum: ['tiktok', 'facebook', 'website'],
    description: 'Kênh khách đến',
  })
  @IsOptional()
  @IsIn(['tiktok', 'facebook', 'website'])
  source?: string;

  @ApiPropertyOptional({
    description: 'Khách có ít nhất một lượt gửi từ campaign này',
  })
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

  @ApiPropertyOptional({ enum: ['new', 'in_crm', 'converted'] })
  @IsOptional()
  @IsIn(['new', 'in_crm', 'converted'])
  status?: string;

  @ApiPropertyOptional({
    enum: ['pending', 'synced', 'failed'],
    description: 'Khách có lượt gửi ở trạng thái này',
  })
  @IsOptional()
  @IsIn(['pending', 'synced', 'failed'])
  sync_status?: string;

  @ApiPropertyOptional({ description: 'Tìm theo tên, email, SĐT' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  q?: string;

  @ApiPropertyOptional({
    enum: ['7d', '30d', '90d'],
    description: 'Theo lượt gửi gần nhất',
  })
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
