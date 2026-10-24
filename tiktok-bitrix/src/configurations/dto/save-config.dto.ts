import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Allow,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  Min,
} from 'class-validator';
import type {
  AlertRulesConfig,
  AssignmentRule,
  DealRule,
  FieldMapping,
} from '../types/configuration.types';

/**
 * GET trả đúng body mà PUT nhận (readme_api.md mục 6), thêm vài khóa chỉ đọc
 * mà PUT bỏ qua: nhờ vậy lưu GET ra tệp, sửa, rồi PUT lại được.
 */
abstract class VersionedDto {
  @ApiProperty({ description: 'Phiên bản đang sửa, lấy từ GET', example: 1 })
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ readOnly: true })
  @IsOptional()
  @Allow()
  updated_at?: unknown;
}

export class SaveMappingDto extends VersionedDto {
  @ApiProperty({
    example: {
      'lead_data.full_name': 'NAME',
      'lead_data.email': 'EMAIL[0][VALUE]',
      'lead_data.phone': 'PHONE[0][VALUE]',
      'lead_data.city': 'UF_CRM_CITY',
    },
  })
  @IsObject()
  field_mapping: FieldMapping;

  @ApiPropertyOptional({ readOnly: true })
  @IsOptional()
  @Allow()
  supported_paths?: unknown;

  @ApiPropertyOptional({ readOnly: true })
  @IsOptional()
  @Allow()
  reserved_fields?: unknown;
}

export class SaveRulesDto extends VersionedDto {
  @ApiProperty({
    example: [
      {
        condition: "campaign.campaign_name CONTAINS 'sale'",
        action: 'create_deal',
        pipeline_id: '1',
        stage_id: 'NEW',
        probability: 30,
      },
    ],
  })
  @IsArray()
  deal_rules: DealRule[];

  @ApiProperty({
    example: { '1': { NEW: 30, PREPARATION: 50, WON: 100, LOSE: 0 } },
  })
  @IsObject()
  stage_probability: Record<string, Record<string, number>>;

  @ApiProperty({
    example: [
      { condition: "lead_data.city = 'Hà Nội'", user_ids: [7, 9] },
      { condition: '*', user_ids: [12] },
    ],
  })
  @IsArray()
  assignment_rules: AssignmentRule[];
}

export class SaveAlertsDto extends VersionedDto {
  @ApiProperty({
    example: { cpl_max: 80000, conversion_drop_percent: 30, min_leads: 20 },
  })
  @IsObject()
  alert_rules: AlertRulesConfig;
}
