import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/** Body của POST /api/v1/leads/:uuid/convert-to-deal; thiếu thì lấy như luồng tự động. */
export class ConvertToDealDto {
  @ApiPropertyOptional({
    description: 'Mặc định: lượt gửi mới nhất chưa có deal',
  })
  @IsOptional()
  @IsUUID()
  lead_submission_uuid?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString()
  pipeline_id?: string;

  @ApiPropertyOptional({ example: 'NEW' })
  @IsOptional()
  @IsString()
  stage_id?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @ApiPropertyOptional({ example: 10000000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ example: 9 })
  @IsOptional()
  @IsInt()
  @Min(1)
  assigned_to?: number;
}
