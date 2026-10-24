import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { VALIDATION } from '../../common/constants/messages.constant';

/** Giây hợp lệ: từ 2000-01-01 tới 2100-01-01 (bắt nhầm mili giây). */
const MIN_TIMESTAMP = 946_684_800;
const MAX_TIMESTAMP = 4_102_444_800;
const max255 = { message: VALIDATION.MAX_LENGTH(255) };

class CampaignDto {
  @IsOptional() @IsString() @MaxLength(255, max255) campaign_id?: string;
  @IsOptional() @IsString() @MaxLength(255, max255) campaign_name?: string;
  @IsOptional() @IsString() @MaxLength(255, max255) ad_id?: string;
  @IsOptional() @IsString() @MaxLength(255, max255) ad_name?: string;
}

class FormDto {
  @IsOptional() @IsString() @MaxLength(255, max255) form_id?: string;
  @IsOptional() @IsString() @MaxLength(255, max255) form_name?: string;
}

class LeadDataDto {
  @IsString({ message: VALIDATION.REQUIRED })
  @IsNotEmpty({ message: VALIDATION.REQUIRED })
  @MaxLength(255, max255)
  full_name: string;

  @IsOptional() @IsString() @MaxLength(255, max255) email?: string;
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: VALIDATION.MAX_LENGTH(50) })
  phone?: string;
  @IsOptional() @IsString() @MaxLength(255, max255) city?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: VALIDATION.MAX_ITEMS(20) })
  @IsString({ each: true })
  @MaxLength(255, { each: true, ...max255 })
  interests?: string[];

  @IsOptional() @IsString() @MaxLength(255, max255) utm_source?: string;
  @IsOptional() @IsString() @MaxLength(255, max255) utm_campaign?: string;
  @IsOptional() @IsString() @MaxLength(255, max255) ttclid?: string;
}

class CustomQuestionDto {
  @IsString() @IsNotEmpty() @MaxLength(255, max255) question: string;
  @IsString()
  @MaxLength(1000, { message: VALIDATION.MAX_LENGTH(1000) })
  answer: string;
}

/** Luật của payload lead đã làm sạch (readme_design.md mục 4.2). */
export class LeadEventDto {
  @IsIn(['lead.generate', 'form.complete'])
  event: string;

  @IsString({ message: VALIDATION.REQUIRED })
  @IsNotEmpty({ message: VALIDATION.REQUIRED })
  @MaxLength(255, max255)
  event_id: string;

  @IsInt({ message: VALIDATION.TIMESTAMP })
  @Min(MIN_TIMESTAMP, { message: VALIDATION.TIMESTAMP })
  @Max(MAX_TIMESTAMP, { message: VALIDATION.TIMESTAMP })
  timestamp: number;

  @IsOptional() @IsString() @MaxLength(255, max255) advertiser_id?: string;

  @ValidateNested() @Type(() => CampaignDto) campaign: CampaignDto;
  @ValidateNested() @Type(() => FormDto) form: FormDto;
  @ValidateNested() @Type(() => LeadDataDto) lead_data: LeadDataDto;

  @IsArray()
  @ArrayMaxSize(50, { message: VALIDATION.MAX_ITEMS(50) })
  @ValidateNested({ each: true })
  @Type(() => CustomQuestionDto)
  custom_questions: CustomQuestionDto[];
}

/** Luật của user.interaction. */
export class InteractionDto {
  @IsString() @IsNotEmpty() @MaxLength(255, max255) event_id: string;

  @IsInt({ message: VALIDATION.TIMESTAMP })
  @Min(MIN_TIMESTAMP, { message: VALIDATION.TIMESTAMP })
  @Max(MAX_TIMESTAMP, { message: VALIDATION.TIMESTAMP })
  timestamp: number;

  @IsIn(['ad_click', 'form_open'], { message: VALIDATION.INTERACTION_TYPE })
  type: string;

  @IsOptional() @IsString() @MaxLength(255, max255) advertiser_id?: string;
  @IsOptional() @IsString() @MaxLength(255, max255) campaign_id?: string;
  @IsOptional() @IsString() @MaxLength(255, max255) ad_id?: string;
  @IsOptional() @IsString() @MaxLength(255, max255) form_id?: string;
  @IsOptional() @IsString() @MaxLength(255, max255) ttclid?: string;
}
