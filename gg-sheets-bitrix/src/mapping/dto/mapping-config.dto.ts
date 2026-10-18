import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { VALIDATION } from '../../common/constants/messages.constant';
import { MAPPING_OWNERS, type MappingOwner } from '../types/mapping.types';

/** Trường dùng để tra trùng (đề: "dựa trên Email hoặc Số điện thoại"). */
export const DUPLICATE_KEY_FIELDS = ['EMAIL', 'PHONE'];

/** Hình dạng một cột trong mapping (kiểm tra tầng 1: cấu trúc). */
export class MappingColumnDto {
  @IsString({ message: VALIDATION.MAPPING.HEADER_REQUIRED })
  @IsNotEmpty({ message: VALIDATION.MAPPING.HEADER_REQUIRED })
  header: string;

  @IsString({ message: VALIDATION.MAPPING.FIELD_FORMAT })
  @Matches(/^[A-Z][A-Z0-9_]*$/, { message: VALIDATION.MAPPING.FIELD_FORMAT })
  field: string;

  @IsOptional()
  @IsArray({ message: VALIDATION.MAPPING.RULES_FORMAT })
  @IsString({ each: true, message: VALIDATION.MAPPING.RULES_FORMAT })
  rules?: string[];

  @IsOptional()
  @IsObject({ message: VALIDATION.MAPPING.VALUE_MAP_FORMAT })
  value_map?: Record<string, string>;

  @IsOptional()
  @IsIn(MAPPING_OWNERS, { message: VALIDATION.MAPPING.OWNER_FORMAT })
  owner?: MappingOwner;
}

/** Hình dạng cả mapping. */
export class MappingConfigDto {
  @IsArray({ message: VALIDATION.MAPPING.COLUMNS_REQUIRED })
  @ArrayMinSize(1, { message: VALIDATION.MAPPING.COLUMNS_REQUIRED })
  @ValidateNested({ each: true })
  @Type(() => MappingColumnDto)
  columns: MappingColumnDto[];

  @IsArray({ message: VALIDATION.MAPPING.DUPLICATE_KEYS_FORMAT })
  @ArrayMinSize(1, { message: VALIDATION.MAPPING.DUPLICATE_KEYS_FORMAT })
  @IsIn(DUPLICATE_KEY_FIELDS, {
    each: true,
    message: VALIDATION.MAPPING.DUPLICATE_KEYS_FORMAT,
  })
  duplicate_keys: string[];

  @IsOptional()
  @IsString({ message: VALIDATION.MAPPING.LEAD_TITLE_FORMAT })
  lead_title?: string;
}
